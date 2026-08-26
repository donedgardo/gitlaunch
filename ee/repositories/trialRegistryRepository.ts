// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { Db, ObjectId, Collection } from "mongodb";

export type TrialRegistryEntry = {
  _id: ObjectId;
  // Stable per-person identity so a single person can't farm multiple free
  // trials across accounts. Prefixed by auth method, e.g. "github:123" or
  // "user:<objectId>" for Google/email signups.
  subject: string;
  accountId: ObjectId;
  claimedAt: Date;
};

export class TrialRegistryRepository {
  private collection: Collection<TrialRegistryEntry>;

  constructor(db: Db) {
    this.collection = db.collection<TrialRegistryEntry>("trialRegistry");
  }

  async claimTrial(subject: string, accountId: ObjectId): Promise<boolean> {
    try {
      await this.collection.insertOne({
        subject,
        accountId,
        claimedAt: new Date(),
      } as TrialRegistryEntry);
      return true;
    } catch (error: any) {
      // MongoDB duplicate key error code
      if (error.code === 11000) {
        return false;
      }
      throw error;
    }
  }

  async hasUsedTrial(subject: string): Promise<boolean> {
    const entry = await this.collection.findOne({ subject });
    return entry !== null;
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ subject: 1 }, { unique: true });
  }
}
