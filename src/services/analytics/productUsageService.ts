import { Collection, Db, ObjectId } from "mongodb";
import { AnalyticsEvent } from "../../repositories/analyticsEventRepository";
import { ActorKind, actorMatch, classifyActor } from "./actorIdentity";

export type UsageInterval = "day" | "week";

export type UsageRange = { from: Date; to: Date; accountId?: ObjectId };

export type AudienceBreakdown = Record<ActorKind, number>;

export type ActiveUsersPoint = { bucket: Date; users: number };

export type FeatureAdoptionRow = {
  event: string;
  users: number;
  occurrences: number;
};

export type FunnelStep = {
  step: string;
  users: number;
  // Share of the people who entered the funnel that reached this step.
  rateFromStart: number;
  // Share of the previous step's people that reached this step.
  rateFromPrevious: number;
};

/**
 * Read-side product usage reporting over the analytics warehouse: who is
 * active, which features they touch, and where they fall out of a journey.
 *
 * Account scope is optional: pass an accountId to look at one tenant, omit it
 * to look across the whole warehouse (how the internal team reads its own
 * product). Every query is bounded by a time range.
 */
export class ProductUsageService {
  private collection: Collection<AnalyticsEvent>;

  constructor(db: Db) {
    this.collection = db.collection<AnalyticsEvent>("analytics_events");
  }

  /**
   * Distinct actors active per day or week.
   *
   * Pass an `audience` to count one kind of actor — `"user"` is the honest
   * answer to "how many people used the product", since the default counts
   * anonymous landing visitors and API keys too.
   */
  async activeUsers(
    params: UsageRange & { interval: UsageInterval; audience?: ActorKind },
  ): Promise<ActiveUsersPoint[]> {
    const rows = await this.collection
      .aggregate<{ _id: Date; users: number }>([
        {
          $match: {
            ...this.rangeMatch(params),
            distinctId: { $ne: null },
            ...(params.audience ? actorMatch(params.audience) : {}),
          },
        },
        // Collapse to one row per (bucket, person) before counting, so an
        // active person is counted once however busy they were.
        {
          $group: {
            _id: {
              bucket: {
                $dateTrunc: {
                  date: "$timestamp",
                  unit: params.interval,
                  timezone: "UTC",
                },
              },
              distinctId: "$distinctId",
            },
          },
        },
        { $group: { _id: "$_id.bucket", users: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    return rows.map((row) => ({ bucket: row._id, users: row.users }));
  }

  /**
   * Distinct actors in the window, split by what they are. Reported alongside
   * any headline "active users" number so product usage is never conflated
   * with landing-page traffic or CI robots.
   */
  async audienceBreakdown(range: UsageRange): Promise<AudienceBreakdown> {
    const ids = await this.collection.distinct("distinctId", {
      ...this.rangeMatch(range),
      distinctId: { $exists: true },
    });

    const breakdown: AudienceBreakdown = {
      user: 0,
      machine: 0,
      visitor: 0,
      unknown: 0,
    };
    for (const id of ids) breakdown[classifyActor(id)]++;
    return breakdown;
  }

  /** Reach (distinct people) and volume (occurrences) per tracked event. */
  async featureAdoption(range: UsageRange): Promise<FeatureAdoptionRow[]> {
    const rows = await this.collection
      .aggregate<{
        _id: string;
        occurrences: number;
        people: (string | null)[];
      }>([
        // "identify" rows are bookkeeping, not product usage.
        { $match: { ...this.rangeMatch(range), type: "track" } },
        {
          $group: {
            _id: "$event",
            occurrences: { $sum: 1 },
            people: { $addToSet: "$distinctId" },
          },
        },
      ])
      .toArray();

    return rows
      .map((row) => ({
        event: row._id,
        users: row.people.filter((p) => p != null).length,
        occurrences: row.occurrences,
      }))
      .sort(
        (a, b) =>
          b.users - a.users ||
          b.occurrences - a.occurrences ||
          a.event.localeCompare(b.event),
      );
  }

  /**
   * Step-by-step drop-off. Each step keeps only the people who also cleared
   * every earlier step within the window, so later steps can never report more
   * people than the ones before them.
   *
   * Membership is set-based rather than sequence-based: it asks "did this
   * person do all of these things in the window", not "did they do them in
   * this order".
   */
  async funnel(
    params: UsageRange & { steps: string[] },
  ): Promise<FunnelStep[]> {
    const cohorts: Set<string>[] = [];
    for (const step of params.steps) {
      const ids = await this.collection.distinct("distinctId", {
        ...this.rangeMatch(params),
        event: step,
      });
      cohorts.push(new Set(ids.filter((id): id is string => id != null)));
    }

    let reached = cohorts[0] ?? new Set<string>();
    const entered = reached.size;
    let previous = entered;

    return params.steps.map((step, index) => {
      if (index > 0) {
        const atStep = cohorts[index];
        reached = new Set([...reached].filter((id) => atStep.has(id)));
      }
      const users = reached.size;
      const point: FunnelStep = {
        step,
        users,
        rateFromStart: entered > 0 ? users / entered : 0,
        rateFromPrevious: previous > 0 ? users / previous : 0,
      };
      previous = users;
      return point;
    });
  }

  private rangeMatch(range: UsageRange) {
    const match: Record<string, unknown> = {
      timestamp: { $gte: range.from, $lt: range.to },
    };
    if (range.accountId) match.accountId = range.accountId;
    return match;
  }
}
