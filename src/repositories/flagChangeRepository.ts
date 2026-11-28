import { Db, ObjectId, Collection } from "mongodb";
import { FlagEnvironmentConfig } from "./flagRepository";
import { Actor } from "../services/service/actor";

export type FlagChangeKind = "created" | "configured" | "deleted";

/**
 * One append-only entry in a service's flag history: who changed a flag,
 * where, and why.
 *
 * Config versions already record *what* an environment's flags looked like
 * after each change, but they are deduplicated snapshots of the whole set and
 * carry no author. This is the other half: one entry per change someone made.
 *
 * `environment`, `before` and `after` are present only on "configured" —
 * creating or deleting a flag touches every environment at once.
 */
export type FlagChange = {
  _id: ObjectId;
  accountId: ObjectId;
  serviceId: ObjectId;
  flagKey: string;
  change: FlagChangeKind;
  environment?: string;
  before?: FlagEnvironmentConfig;
  after?: FlagEnvironmentConfig;
  actor: Actor;
  reason?: string;
  at: Date;
};

export type RecordFlagChangeInput = Omit<FlagChange, "_id" | "at">;

const DEFAULT_LIMIT = 50;

export class FlagChangeRepository {
  private collection: Collection<FlagChange>;

  constructor(db: Db) {
    this.collection = db.collection<FlagChange>("flagChanges");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ accountId: 1, serviceId: 1, at: -1 });
  }

  async record(input: RecordFlagChangeInput): Promise<FlagChange> {
    const change: Omit<FlagChange, "_id"> = { ...input, at: new Date() };
    const result = await this.collection.insertOne(change as FlagChange);
    return { _id: result.insertedId, ...change };
  }

  // Newest first, with `_id` breaking ties between changes in the same
  // millisecond so the order is the order they were written.
  async listByService(
    accountId: ObjectId,
    serviceId: ObjectId,
    limit: number = DEFAULT_LIMIT,
  ): Promise<FlagChange[]> {
    return this.collection
      .find({ accountId, serviceId })
      .sort({ at: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }
}
