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
    throw new Error("not implemented");
  }

  async ensureIndexes(): Promise<void> {
    throw new Error("not implemented");
  }
}
