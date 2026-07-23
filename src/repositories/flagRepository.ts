import { Db, ObjectId, Collection } from "mongodb";

export type FlagVariant = {
  key: string;
  weight: number; // integer 0..100; across a flag's variants must sum to 100
};

export type FlagEnvironmentConfig = {
  enabled: boolean; // master gate for this environment
  rolloutPercentage: number; // 0..100 gradual rollout among enabled traffic
  variants: FlagVariant[]; // empty => boolean flag; non-empty => A/B split
};

export type Flag = {
  _id: ObjectId;
  accountId: ObjectId;
  serviceId: ObjectId;
  key: string; // stable code identifier, e.g. "new-checkout"
  description: string;
  environments: Record<string, FlagEnvironmentConfig>; // keyed by environment name
  createdAt: Date;
  updatedAt: Date;
};

export type CreateFlagInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  key: string;
  description: string;
  environments: Record<string, FlagEnvironmentConfig>;
};

export function defaultEnvironmentConfig(): FlagEnvironmentConfig {
  return { enabled: false, rolloutPercentage: 0, variants: [] };
}

export class FlagRepository {
  private collection: Collection<Flag>;

  constructor(db: Db) {
    this.collection = db.collection<Flag>("flags");
  }

  async ensureIndexes(): Promise<void> {
    // Unique compound index for tenant isolation and duplicate prevention
    await this.collection.createIndex(
      { accountId: 1, serviceId: 1, key: 1 },
      { unique: true },
    );
    // Index for listing a service's flags
    await this.collection.createIndex({
      accountId: 1,
      serviceId: 1,
      createdAt: -1,
    });
  }

  async create(input: CreateFlagInput): Promise<Flag> {
    const now = new Date();
    const flag: Omit<Flag, "_id"> = {
      accountId: input.accountId,
      serviceId: input.serviceId,
      key: input.key,
      description: input.description,
      environments: input.environments,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.collection.insertOne(flag as Flag);
    return { _id: result.insertedId, ...flag };
  }

  async findByKey(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
  ): Promise<Flag | null> {
    return this.collection.findOne({ accountId, serviceId, key });
  }

  async findByAccountAndService(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<Flag[]> {
    return this.collection
      .find({ accountId, serviceId })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async updateEnvConfig(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
    envName: string,
    config: FlagEnvironmentConfig,
  ): Promise<Flag | null> {
    return this.collection.findOneAndUpdate(
      { accountId, serviceId, key },
      {
        $set: {
          [`environments.${envName}`]: config,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
  }

  async delete(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
  ): Promise<boolean> {
    const result = await this.collection.deleteOne({
      accountId,
      serviceId,
      key,
    });
    return result.deletedCount === 1;
  }
}
