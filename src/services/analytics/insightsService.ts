import { Db, ObjectId } from "mongodb";
import {
  ExperimentResultsService,
  EXPOSURE_EVENT,
} from "../flag/experimentResultsService";
import {
  CampaignAnalyticsService,
  SIGNUP_EVENT,
} from "./campaignAnalyticsService";
import { analyzeExperiment, ExperimentAnalysis } from "./experimentAnalysis";
import { InsightsReport } from "./insightsReport";
import { ProductUsageService, UsageInterval } from "./productUsageService";
import { InternalTraffic } from "./internalTraffic";

export type InsightsQuery = {
  from: Date;
  to: Date;
  // Scope product usage to one tenant; omitted means the whole warehouse.
  accountId?: ObjectId;
  interval?: UsageInterval;
  funnelSteps?: string[];
};

/** The journey the team watches by default: sign in, build, deploy. */
export const DEFAULT_FUNNEL = [
  "user_logged_in",
  "build_reported",
  "deployment_status_updated",
];

type DiscoveredExperiment = {
  accountId: ObjectId;
  serviceId: string;
  flagKey: string;
  environment: string;
};

/**
 * Composes the whole marketing + product briefing for a window: which
 * campaigns converted, how the running experiments are doing, how the product
 * is being used, and what about the data itself should not be trusted.
 *
 * Experiments are discovered from the exposure events themselves rather than
 * from the flag collection, so an experiment still reports even if its flag
 * was renamed or deleted after the fact.
 */
export class InsightsService {
  private campaigns: CampaignAnalyticsService;
  private usage: ProductUsageService;
  private experiments: ExperimentResultsService;

  constructor(
    private db: Db,
    // Read from the environment by default: the briefing is the one place that
    // should never quietly count our own traffic as customers'.
    internal: InternalTraffic = InternalTraffic.fromEnv(),
  ) {
    this.campaigns = new CampaignAnalyticsService(db, internal);
    this.usage = new ProductUsageService(db, internal);
    this.experiments = new ExperimentResultsService(db, internal);
  }

  async build(query: InsightsQuery): Promise<InsightsReport> {
    const { from, to } = query;
    const interval = query.interval ?? "day";
    const steps = query.funnelSteps ?? DEFAULT_FUNNEL;

    const [
      campaigns,
      experiments,
      activeUsers,
      audience,
      features,
      funnel,
      warnings,
    ] = await Promise.all([
      this.campaigns.campaignPerformance({ from, to }),
      this.analyzeRunningExperiments(query),
      // Headline usage is logged-in people; everyone else is itemised below,
      // so landing traffic is never quoted as product DAU.
      this.usage.activeUsers({
        from,
        to,
        interval,
        accountId: query.accountId,
        audience: "user",
      }),
      this.usage.audienceBreakdown({ from, to, accountId: query.accountId }),
      this.usage.featureAdoption({ from, to, accountId: query.accountId }),
      this.usage.funnel({ from, to, steps, accountId: query.accountId }),
      this.collectWarnings(query),
    ]);

    return {
      from,
      to,
      campaigns,
      experiments,
      usage: { activeUsers, audience, features, funnel },
      warnings,
    };
  }

  private async analyzeRunningExperiments(
    query: InsightsQuery,
  ): Promise<ExperimentAnalysis[]> {
    const discovered = await this.discoverExperiments(query);

    const analyses = await Promise.all(
      discovered.map(async (experiment) => {
        const results = await this.experiments.getResults({
          accountId: experiment.accountId,
          serviceId: new ObjectId(experiment.serviceId),
          flagKey: experiment.flagKey,
          environment: experiment.environment,
          from: query.from,
          to: query.to,
        });
        return analyzeExperiment(results);
      }),
    );

    return analyses.sort(
      (a, b) =>
        a.flagKey.localeCompare(b.flagKey) ||
        a.environment.localeCompare(b.environment),
    );
  }

  /** Every (account, service, flag, environment) that saw an exposure. */
  private async discoverExperiments(
    query: InsightsQuery,
  ): Promise<DiscoveredExperiment[]> {
    const rows = await this.db
      .collection("analytics_events")
      .aggregate<{
        _id: {
          accountId: ObjectId | null;
          serviceId: string | null;
          flagKey: string | null;
          environment: string | null;
        };
      }>([
        {
          $match: {
            event: EXPOSURE_EVENT,
            timestamp: { $gte: query.from, $lt: query.to },
          },
        },
        {
          $group: {
            _id: {
              accountId: "$accountId",
              serviceId: "$properties.serviceId",
              flagKey: "$properties.flagKey",
              environment: "$properties.environment",
            },
          },
        },
      ])
      .toArray();

    // Exposures missing tenant or flag identity can't be looked up; they are
    // surfaced as a warning instead of being silently analysed as their own
    // experiment.
    return rows
      .filter(
        (row): row is { _id: DiscoveredExperiment } =>
          row._id.accountId != null &&
          row._id.serviceId != null &&
          row._id.flagKey != null &&
          row._id.environment != null,
      )
      .map((row) => row._id);
  }

  private async collectWarnings(query: InsightsQuery): Promise<string[]> {
    const warnings: string[] = [];
    const events = this.db.collection("analytics_events");
    const window = { $gte: query.from, $lt: query.to };

    const [signupsTotal, signupsWithoutAccount, exposuresWithoutAccount] =
      await Promise.all([
        events.countDocuments({ event: SIGNUP_EVENT, timestamp: window }),
        events.countDocuments({
          event: SIGNUP_EVENT,
          timestamp: window,
          accountId: { $exists: false },
        }),
        events.countDocuments({
          event: EXPOSURE_EVENT,
          timestamp: window,
          accountId: { $exists: false },
        }),
      ]);

    if (signupsWithoutAccount > 0) {
      warnings.push(
        `${signupsWithoutAccount} of ${signupsTotal} \`${SIGNUP_EVENT}\` events have no accountId, so they are invisible to every tenant-scoped dashboard query.`,
      );
    }

    if (exposuresWithoutAccount > 0) {
      warnings.push(
        `${exposuresWithoutAccount} \`${EXPOSURE_EVENT}\` events have no accountId and were left out of the experiment analysis.`,
      );
    }

    const unattributed = await this.eventsWithoutAnActor(query);
    if (unattributed.length > 0) {
      warnings.push(
        `These events never record a distinctId, so they cannot appear in funnels or per-user usage: ${unattributed
          .map((e) => `\`${e.event}\` (${e.occurrences}×)`)
          .join(", ")}.`,
      );
    }

    const leads = await this.countLeads(query);
    if (leads > signupsTotal) {
      warnings.push(
        `The \`leads\` collection holds ${leads} signup(s) in this window but the warehouse only recorded ${signupsTotal} \`${SIGNUP_EVENT}\` event(s) — campaign attribution is undercounting.`,
      );
    }

    return warnings;
  }

  /**
   * Tracked events that fired in the window without ever carrying a
   * distinctId. They inflate volume charts while contributing nothing to
   * funnels, retention or per-user usage — an instrumentation gap, not a
   * quiet zero.
   */
  private async eventsWithoutAnActor(
    query: InsightsQuery,
  ): Promise<Array<{ event: string; occurrences: number }>> {
    return this.db
      .collection("analytics_events")
      .aggregate<{ event: string; occurrences: number }>([
        {
          $match: {
            type: "track",
            timestamp: { $gte: query.from, $lt: query.to },
            ...(query.accountId ? { accountId: query.accountId } : {}),
          },
        },
        {
          $group: {
            _id: "$event",
            occurrences: { $sum: 1 },
            identified: {
              $sum: { $cond: [{ $ifNull: ["$distinctId", false] }, 1, 0] },
            },
          },
        },
        { $match: { identified: 0 } },
        { $project: { _id: 0, event: "$_id", occurrences: 1 } },
        { $sort: { occurrences: -1, event: 1 } },
      ])
      .toArray();
  }

  private async countLeads(query: InsightsQuery): Promise<number> {
    const collections = await this.db
      .listCollections({ name: "leads" })
      .toArray();
    if (collections.length === 0) return 0;

    return this.db
      .collection("leads")
      .countDocuments({ createdAt: { $gte: query.from, $lt: query.to } });
  }
}
