import { Db, ObjectId, Collection } from "mongodb";
import { DeploymentStatus } from "../services/service/deploymentStatus";
import { DeploymentLogRecord } from "../services/service/deploymentLogsRecord";

export type Build = {
  _id: ObjectId;
  accountId: ObjectId;
  repositoryId: ObjectId;
  buildId: string;
  deployments: Record<string, DeploymentStatus>;
  deploymentLogs: DeploymentLogRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBuildInput = {
  accountId: ObjectId;
  repositoryId: ObjectId;
  buildId: string;
};

export class BuildRepository {
  private collection: Collection<Build>;

  constructor(db: Db) {
    this.collection = db.collection<Build>("builds");
  }

  async create(input: CreateBuildInput): Promise<Build> {
    // Check if build already exists for this account/repo/buildId combination
    const existing = await this.findByBuildId(
      input.accountId,
      input.repositoryId,
      input.buildId,
    );
    if (existing) {
      return existing;
    }

    const now = new Date();
    const build: Omit<Build, "_id"> = {
      accountId: input.accountId,
      repositoryId: input.repositoryId,
      buildId: input.buildId,
      deployments: {},
      deploymentLogs: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.collection.insertOne(build as Build);
    return { _id: result.insertedId, ...build };
  }

  async findByBuildId(
    accountId: ObjectId,
    repositoryId: ObjectId,
    buildId: string,
  ): Promise<Build | null> {
    return this.collection.findOne({ accountId, repositoryId, buildId });
  }

  async findByAccountAndRepo(
    accountId: ObjectId,
    repositoryId: ObjectId,
  ): Promise<Build[]> {
    return this.collection
      .find({ accountId, repositoryId })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async updateDeploymentStatus(
    accountId: ObjectId,
    repositoryId: ObjectId,
    buildId: string,
    environment: string,
    status: DeploymentStatus,
  ): Promise<Build | null> {
    const log: DeploymentLogRecord = { environment, status };

    const result = await this.collection.findOneAndUpdate(
      { accountId, repositoryId, buildId },
      {
        $set: {
          [`deployments.${environment}`]: status,
          updatedAt: new Date(),
        },
        $push: { deploymentLogs: log },
      },
      { returnDocument: "after" },
    );

    return result;
  }
}
