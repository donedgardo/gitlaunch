import { Db, ObjectId, Collection } from "mongodb";

export type WebhookEvent = {
  _id: ObjectId;
  stripeEventId: string;
  eventType: string;
  processedAt: Date;
  payload: Record<string, unknown>;
};

export class WebhookEventRepository {
  private collection: Collection<WebhookEvent>;

  constructor(db: Db) {
    this.collection = db.collection<WebhookEvent>("webhookEvents");
  }

  async markAsProcessed(
    stripeEventId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.collection.insertOne({
        stripeEventId,
        eventType,
        processedAt: new Date(),
        payload,
      } as WebhookEvent);
      return true;
    } catch (error: any) {
      // MongoDB duplicate key error code
      if (error.code === 11000) {
        return false;
      }
      throw error;
    }
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ stripeEventId: 1 }, { unique: true });
    // TTL index for automatic cleanup after 90 days (Stripe retries stop after 3 days, but keep for audit)
    await this.collection.createIndex(
      { processedAt: 1 },
      { expireAfterSeconds: 90 * 24 * 60 * 60 },
    );
  }
}
