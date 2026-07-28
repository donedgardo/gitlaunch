import { Collection, Db } from "mongodb";
import { AnalyticsEvent } from "../../repositories/analyticsEventRepository";
import { InternalTraffic } from "./internalTraffic";

export type AttributionDimension =
  | "campaign"
  | "source"
  | "medium"
  | "content"
  | "term";

export type MarketingRange = { from: Date; to: Date };

export type CampaignRow = {
  campaign: string;
  source: string;
  medium: string;
  signups: number;
  uniqueVisitors: number;
  firstSignup: Date;
  lastSignup: Date;
};

export type AttributionBucket = { value: string; signups: number };

// The conversion the marketing funnel is measured against today.
export const SIGNUP_EVENT = "waitlist_signup";

// GA-style labels for traffic that arrived without UTM tagging.
const UNTAGGED_SOURCE = "(direct)";
const UNTAGGED_MEDIUM = "(none)";

/**
 * Marketing acquisition reporting over the analytics warehouse: which campaign,
 * source and medium actually produced waitlist signups.
 *
 * Deliberately NOT tenant-scoped. Waitlist signups are GitLaunch's own
 * top-of-funnel and are captured for anonymous visitors, so many carry no
 * accountId at all — filtering by account would silently drop real conversions.
 * Every query is bounded by a time range instead.
 */
export class CampaignAnalyticsService {
  private collection: Collection<AnalyticsEvent>;

  constructor(
    db: Db,
    // Our own signups aren't acquisition. Defaults to "exclude nothing" so an
    // unconfigured deployment reports exactly what it did before.
    private internal: InternalTraffic = InternalTraffic.fromEnv({}),
  ) {
    this.collection = db.collection<AnalyticsEvent>("analytics_events");
  }

  /**
   * One row per campaign/source/medium combination that converted in the
   * window, ranked by signups.
   */
  async campaignPerformance(range: MarketingRange): Promise<CampaignRow[]> {
    const rows = await this.collection
      .aggregate<{
        _id: { campaign: string; source: string; medium: string };
        signups: number;
        visitors: (string | null)[];
        firstSignup: Date;
        lastSignup: Date;
      }>([
        { $match: this.signupMatch(range) },
        {
          $group: {
            _id: {
              campaign: this.tagged("campaign", UNTAGGED_SOURCE),
              source: this.tagged("source", UNTAGGED_SOURCE),
              medium: this.tagged("medium", UNTAGGED_MEDIUM),
            },
            signups: { $sum: 1 },
            visitors: { $addToSet: "$distinctId" },
            firstSignup: { $min: "$timestamp" },
            lastSignup: { $max: "$timestamp" },
          },
        },
        { $sort: { signups: -1, "_id.campaign": 1 } },
      ])
      .toArray();

    return rows.map((row) => ({
      campaign: row._id.campaign,
      source: row._id.source,
      medium: row._id.medium,
      signups: row.signups,
      uniqueVisitors: row.visitors.filter((v) => v != null).length,
      firstSignup: row.firstSignup,
      lastSignup: row.lastSignup,
    }));
  }

  /** Signup totals for a single attribution dimension, ranked. */
  async breakdownBy(
    params: MarketingRange & { dimension: AttributionDimension },
  ): Promise<AttributionBucket[]> {
    const untagged =
      params.dimension === "medium" ? UNTAGGED_MEDIUM : UNTAGGED_SOURCE;

    const rows = await this.collection
      .aggregate<{ _id: string; signups: number }>([
        { $match: this.signupMatch(params) },
        {
          $group: {
            _id: this.tagged(params.dimension, untagged),
            signups: { $sum: 1 },
          },
        },
        { $sort: { signups: -1, _id: 1 } },
      ])
      .toArray();

    return rows.map((row) => ({ value: row._id, signups: row.signups }));
  }

  private signupMatch(range: MarketingRange) {
    return {
      event: SIGNUP_EVENT,
      timestamp: { $gte: range.from, $lt: range.to },
      ...this.internal.excludeMatch(),
    };
  }

  // UTM properties are written as explicit nulls when a visitor arrives
  // untagged, so both null and missing have to fall back to the same label.
  private tagged(property: AttributionDimension, fallback: string) {
    return {
      $ifNull: [`$properties.${property}`, fallback],
    };
  }
}
