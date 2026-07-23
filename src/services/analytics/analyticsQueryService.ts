import { Collection, Db, ObjectId } from "mongodb";
import { AnalyticsEvent } from "../../repositories/analyticsEventRepository";

export type Interval = "hour" | "day";

export type VolumePoint = { bucket: Date; count: number };
export type EventCount = { event: string; count: number };
export type BreakdownBucket = { value: string; count: number };

type RangeQuery = {
  accountId: ObjectId;
  from: Date;
  to: Date;
};

/**
 * Read-side aggregations over the analytics warehouse. Every query is scoped to
 * a single account (tenant isolation) and a time range. Uses MongoDB
 * aggregation ($dateTrunc, requires MongoDB 5.0+).
 */
export class AnalyticsQueryService {
  private collection: Collection<AnalyticsEvent>;

  constructor(db: Db) {
    this.collection = db.collection<AnalyticsEvent>("analytics_events");
  }

  async eventVolume(
    params: RangeQuery & { event?: string; interval: Interval },
  ): Promise<VolumePoint[]> {
    const results = await this.collection
      .aggregate<{ _id: Date; count: number }>([
        { $match: this.rangeMatch(params, params.event) },
        {
          $group: {
            _id: {
              $dateTrunc: {
                date: "$timestamp",
                unit: params.interval,
                timezone: "UTC",
              },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    return results.map((r) => ({ bucket: r._id, count: r.count }));
  }

  async uniqueUsers(params: RangeQuery & { event?: string }): Promise<number> {
    const results = await this.collection
      .aggregate<{ _id: null; count: number }>([
        {
          $match: {
            ...this.rangeMatch(params, params.event),
            distinctId: { $ne: null },
          },
        },
        { $group: { _id: "$distinctId" } },
        { $count: "count" },
      ])
      .toArray();

    return results[0]?.count ?? 0;
  }

  async topEvents(
    params: RangeQuery & { limit: number },
  ): Promise<EventCount[]> {
    const results = await this.collection
      .aggregate<{
        _id: string;
        count: number;
      }>([
        { $match: this.rangeMatch(params) },
        { $group: { _id: "$event", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: params.limit },
      ])
      .toArray();

    return results.map((r) => ({ event: r._id, count: r.count }));
  }

  async breakdownBy(
    params: RangeQuery & { property: string; event?: string },
  ): Promise<BreakdownBucket[]> {
    const results = await this.collection
      .aggregate<{ _id: any; count: number }>([
        { $match: this.rangeMatch(params, params.event) },
        {
          $group: {
            _id: `$properties.${params.property}`,
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
      ])
      .toArray();

    return results.map((r) => ({
      value: r._id === null || r._id === undefined ? "(none)" : String(r._id),
      count: r.count,
    }));
  }

  private rangeMatch(range: RangeQuery, event?: string) {
    const match: Record<string, any> = {
      accountId: range.accountId,
      timestamp: { $gte: range.from, $lt: range.to },
    };
    if (event) match.event = event;
    return match;
  }
}
