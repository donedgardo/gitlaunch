import { Db, ObjectId, Collection } from "mongodb";

export type Environment = {
  name: string;
  displayName: string;
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
  { name: "staging", displayName: "Staging", order: 0 },
  { name: "prod", displayName: "Production", order: 1 },
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
}
