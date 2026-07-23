import { Db, ObjectId, Collection } from "mongodb";

export type AnalyticsEventType = "track" | "identify" | "navigation";

export type AnalyticsEvent = {
  _id: ObjectId;
  type: AnalyticsEventType;
  // Event name for "track", destination for "navigation", "$identify" for
  // "identify" (the identified user is carried in distinctId).
  event: string;
  // Tenant scope. Optional because some events happen pre-login (e.g. navigation).
  accountId?: ObjectId;
  // Actor/user identifier.
  distinctId?: string;
  properties: Record<string, any>;
  timestamp: Date;
};

export type CreateAnalyticsEventInput = {
  type: AnalyticsEventType;
  event: string;
  accountId?: ObjectId;
  distinctId?: string;
  properties?: Record<string, any>;
  timestamp?: Date;
};

export class AnalyticsEventRepository {
  private collection: Collection<AnalyticsEvent>;

  constructor(db: Db) {
    this.collection = db.collection<AnalyticsEvent>("analytics_events");
  }

  async ensureIndexes(): Promise<void> {
    // Tenant-scoped time queries (event volume, unique users over a range)
    await this.collection.createIndex({ accountId: 1, timestamp: -1 });
    // Tenant-scoped per-event-name time queries (breakdowns, single-event trends)
    await this.collection.createIndex({
      accountId: 1,
      event: 1,
      timestamp: -1,
    });

    // Optional TTL: expire raw events after a retention window so the
    // warehouse doesn't grow unbounded. Disabled unless configured.
    const retentionDays = parseInt(
      process.env.ANALYTICS_RETENTION_DAYS ?? "",
      10,
    );
    if (Number.isFinite(retentionDays) && retentionDays > 0) {
      await this.collection.createIndex(
        { timestamp: 1 },
        { expireAfterSeconds: retentionDays * 24 * 60 * 60 },
      );
    }
  }

  async insert(input: CreateAnalyticsEventInput): Promise<AnalyticsEvent> {
    const doc: Omit<AnalyticsEvent, "_id"> = {
      type: input.type,
      event: input.event,
      properties: input.properties ?? {},
      timestamp: input.timestamp ?? new Date(),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.distinctId ? { distinctId: input.distinctId } : {}),
    };

    const result = await this.collection.insertOne(doc as AnalyticsEvent);
    return { _id: result.insertedId, ...doc };
  }

  async findByAccount(accountId: ObjectId): Promise<AnalyticsEvent[]> {
    return this.collection
      .find({ accountId })
      .sort({ timestamp: -1 })
      .toArray();
  }
}
