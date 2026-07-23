import { Db, ObjectId, Collection } from "mongodb";
import { FlagConfigBundle } from "../services/flag/configBundle";

// An immutable, versioned snapshot of a service+environment's flag evaluation
// config. Rows are never mutated after insert — a config change appends a new
// version. `version` is monotonic per (accountId, serviceId, environment),
// starting at 1.
export type FlagConfigVersion = {
  _id: ObjectId;
  accountId: ObjectId;
  serviceId: ObjectId;
  environment: string;
  version: number;
  hash: string; // sha256 of the bundle content
  bundle: FlagConfigBundle;
  createdAt: Date;
};

export type InsertFlagConfigVersionInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  environment: string;
  version: number;
  hash: string;
  bundle: FlagConfigBundle;
};

export class FlagConfigVersionRepository {
  private collection: Collection<FlagConfigVersion>;

  constructor(db: Db) {
    this.collection = db.collection<FlagConfigVersion>("flag_config_versions");
  }

  async ensureIndexes(): Promise<void> {
    // One row per version per (tenant, service, environment). Also guards
    // against a racing double-publish inserting the same version number.
    await this.collection.createIndex(
      { accountId: 1, serviceId: 1, environment: 1, version: 1 },
      { unique: true },
    );
  }

  async insert(
    input: InsertFlagConfigVersionInput,
  ): Promise<FlagConfigVersion> {
    const doc: Omit<FlagConfigVersion, "_id"> = {
      ...input,
      createdAt: new Date(),
    };
    const result = await this.collection.insertOne(doc as FlagConfigVersion);
    return { _id: result.insertedId, ...doc };
  }

  async getLatest(
    accountId: ObjectId,
    serviceId: ObjectId,
    environment: string,
  ): Promise<FlagConfigVersion | null> {
    return this.collection
      .find({ accountId, serviceId, environment })
      .sort({ version: -1 })
      .limit(1)
      .next();
  }

  async list(
    accountId: ObjectId,
    serviceId: ObjectId,
    environment: string,
  ): Promise<FlagConfigVersion[]> {
    return this.collection
      .find({ accountId, serviceId, environment })
      .sort({ version: -1 })
      .toArray();
  }

  async getByVersion(
    accountId: ObjectId,
    serviceId: ObjectId,
    environment: string,
    version: number,
  ): Promise<FlagConfigVersion | null> {
    return this.collection.findOne({
      accountId,
      serviceId,
      environment,
      version,
    });
  }
}
