import { Db, ObjectId, Collection } from "mongodb";

export type TrialRegistryEntry = {
  _id: ObjectId;
  githubId: number;
  accountId: ObjectId;
  claimedAt: Date;
};

export class TrialRegistryRepository {
  private collection: Collection<TrialRegistryEntry>;

  constructor(db: Db) {
    this.collection = db.collection<TrialRegistryEntry>("trialRegistry");
  }

  async claimTrial(githubId: number, accountId: ObjectId): Promise<boolean> {
    try {
      await this.collection.insertOne({
        githubId,
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

  async hasUsedTrial(githubId: number): Promise<boolean> {
    const entry = await this.collection.findOne({ githubId });
    return entry !== null;
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ githubId: 1 }, { unique: true });
  }
}
