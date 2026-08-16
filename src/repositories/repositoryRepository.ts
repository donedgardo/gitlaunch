import { Db, ObjectId, Collection } from "mongodb";

export type Repository = {
  _id: ObjectId;
  accountId: ObjectId;
  githubRepoId: number;
  githubFullName: string;
  githubOwner: string;
  githubRepoName: string;
  isPrivate: boolean;
  // GitHub's `default_branch`. Absent on records written before GitLaunch
  // started storing it, so readers must have a fallback.
  defaultBranch?: string;
  createdAt: Date;
};

export type CreateRepositoryInput = {
  accountId: ObjectId;
  githubRepoId: number;
  githubFullName: string;
  githubOwner: string;
  githubRepoName: string;
  isPrivate: boolean;
  defaultBranch?: string;
};

export class RepositoryRepository {
  private collection: Collection<Repository>;

  constructor(db: Db) {
    this.collection = db.collection<Repository>("repositories");
  }

  async create(input: CreateRepositoryInput): Promise<Repository> {
    const now = new Date();
    const repository: Omit<Repository, "_id"> = {
      ...input,
      createdAt: now,
    };

    const result = await this.collection.insertOne(repository as Repository);
    return { _id: result.insertedId, ...repository };
  }

  async findByAccountId(accountId: ObjectId): Promise<Repository[]> {
    return this.collection.find({ accountId }).toArray();
  }

  async findByAccountIdAndGithubRepoId(
    accountId: ObjectId,
    githubRepoId: number,
  ): Promise<Repository | null> {
    return this.collection.findOne({ accountId, githubRepoId });
  }

  async findById(id: ObjectId): Promise<Repository | null> {
    return this.collection.findOne({ _id: id });
  }
}
