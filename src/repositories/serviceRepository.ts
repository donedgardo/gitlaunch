import { Db, ObjectId, Collection } from "mongodb";

export type Environment = {
  name: string;
  order: number;
};

export type Service = {
  _id: ObjectId;
  accountId: ObjectId;
  repositoryId: ObjectId;
  name: string;
  environments: Environment[];
  workflowFile: string;
  eventType: string;
  workflowConfigured: boolean;
  isActive: boolean;
  createdAt: Date;
};

export type CreateServiceInput = {
  accountId: ObjectId;
  repositoryId: ObjectId;
  name: string;
  environments?: Environment[];
  workflowFile?: string;
  eventType?: string;
};

const DEFAULT_ENVIRONMENTS: Environment[] = [
  { name: "staging", order: 0 },
  { name: "prod", order: 1 },
];

export class ServiceRepository {
  private collection: Collection<Service>;

  constructor(db: Db) {
    this.collection = db.collection<Service>("services");
  }

  async ensureIndexes(): Promise<void> {
    // Unique compound index: one service name per repo per account
    await this.collection.createIndex(
      { accountId: 1, repositoryId: 1, name: 1 },
      { unique: true },
    );
  }

  async create(input: CreateServiceInput): Promise<Service> {
    const now = new Date();
    const service: Omit<Service, "_id"> = {
      accountId: input.accountId,
      repositoryId: input.repositoryId,
      name: input.name,
      environments: input.environments || DEFAULT_ENVIRONMENTS,
      workflowFile: input.workflowFile || "deploy.yml",
      eventType: input.eventType || "deployment",
      workflowConfigured: false,
      isActive: true,
      createdAt: now,
    };

    const result = await this.collection.insertOne(service as Service);
    return { _id: result.insertedId, ...service };
  }

  async findById(id: ObjectId): Promise<Service | null> {
    return this.collection.findOne({ _id: id });
  }

  async findByAccountAndId(
    accountId: ObjectId,
    id: ObjectId,
  ): Promise<Service | null> {
    return this.collection.findOne({ _id: id, accountId });
  }

  async findByRepositoryId(
    accountId: ObjectId,
    repositoryId: ObjectId,
  ): Promise<Service[]> {
    return this.collection.find({ accountId, repositoryId }).toArray();
  }

  async findByAccountId(accountId: ObjectId): Promise<Service[]> {
    return this.collection.find({ accountId }).toArray();
  }

  async findByAccountIdAndName(
    accountId: ObjectId,
    name: string,
  ): Promise<Service | null> {
    return this.collection.findOne({ accountId, name });
  }

  async updateWorkflowConfiguration(
    id: ObjectId,
    config: { workflowFile: string; eventType: string },
  ): Promise<Service | null> {
    const result = await this.collection.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          workflowFile: config.workflowFile,
          eventType: config.eventType,
          workflowConfigured: true,
        },
      },
      { returnDocument: "after" },
    );

    return result;
  }

  async markWorkflowConfigured(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      { $set: { workflowConfigured: true } },
    );
  }

  async addEnvironment(
    id: ObjectId,
    env: Environment,
  ): Promise<Service | null> {
    const result = await this.collection.findOneAndUpdate(
      { _id: id },
      { $push: { environments: env } },
      { returnDocument: "after" },
    );
    return result;
  }

  async updateEnvironment(
    id: ObjectId,
    envName: string,
    updates: { order?: number },
  ): Promise<Service | null> {
    const setFields: Record<string, number> = {};
    if (updates.order !== undefined) {
      setFields["environments.$.order"] = updates.order;
    }

    // If no fields to update, just return the current document
    if (Object.keys(setFields).length === 0) {
      return this.findById(id);
    }

    const result = await this.collection.findOneAndUpdate(
      { _id: id, "environments.name": envName },
      { $set: setFields },
      { returnDocument: "after" },
    );

    // If no match (environment not found), return the service as-is
    if (!result) {
      return this.findById(id);
    }

    return result;
  }

  async removeEnvironment(
    id: ObjectId,
    envName: string,
  ): Promise<Service | null> {
    const result = await this.collection.findOneAndUpdate(
      { _id: id },
      { $pull: { environments: { name: envName } } },
      { returnDocument: "after" },
    );
    return result;
  }

  async delete(id: ObjectId): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: id });
    return result.deletedCount === 1;
  }
}
