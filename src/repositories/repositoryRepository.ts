import { Db, ObjectId, Collection } from "mongodb";

export type Environment = {
  name: string;
  displayName: string;
  order: number;
};

export type Repository = {
  _id: ObjectId;
  accountId: ObjectId;
  githubRepoId: number;
  githubFullName: string;
  githubOwner: string;
  githubRepoName: string;
  isPrivate: boolean;
  environments: Environment[];
  workflowFile: string;
  eventType: string;
  isActive: boolean;
  createdAt: Date;
};

export type CreateRepositoryInput = {
  accountId: ObjectId;
  githubRepoId: number;
  githubFullName: string;
  githubOwner: string;
  githubRepoName: string;
  isPrivate: boolean;
};

const DEFAULT_ENVIRONMENTS: Environment[] = [
  { name: "staging", displayName: "Staging", order: 0 },
  { name: "prod", displayName: "Production", order: 1 },
];

export class RepositoryRepository {
  private collection: Collection<Repository>;

  constructor(db: Db) {
    this.collection = db.collection<Repository>("repositories");
  }

  async create(input: CreateRepositoryInput): Promise<Repository> {
    const now = new Date();
    const repository: Omit<Repository, "_id"> = {
      ...input,
      environments: DEFAULT_ENVIRONMENTS,
      workflowFile: "deploy.yml",
      eventType: "deployment",
      isActive: true,
      createdAt: now,
    };

    const result = await this.collection.insertOne(repository as Repository);
    return { _id: result.insertedId, ...repository };
  }

  async findByAccountId(accountId: ObjectId): Promise<Repository[]> {
    return this.collection.find({ accountId }).toArray();
  }
}
