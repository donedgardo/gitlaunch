import { Db, ObjectId, Collection } from "mongodb";
import { DeploymentStatus } from "../services/service/deploymentStatus";
import { DeploymentLogRecord } from "../services/service/deploymentLogsRecord";

export type Build = {
  _id: ObjectId;
  accountId: ObjectId;
  serviceId: ObjectId;
  buildId: string;
  deployments: Record<string, DeploymentStatus>;
  deploymentLogs: DeploymentLogRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBuildInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  buildId: string;
};

export class BuildRepository {
  private collection: Collection<Build>;

  constructor(db: Db) {
    this.collection = db.collection<Build>("builds");
  }

  async ensureIndexes(): Promise<void> {
    // Unique compound index for tenant isolation and duplicate prevention
    await this.collection.createIndex(
      { accountId: 1, serviceId: 1, buildId: 1 },
      { unique: true },
    );
    // Index for listing builds sorted by date
    await this.collection.createIndex({
      accountId: 1,
      serviceId: 1,
      createdAt: -1,
    });
  }

  async create(input: CreateBuildInput): Promise<Build> {
    // Check if build already exists for this account/repo/buildId combination
    const existing = await this.findByBuildId(
      input.accountId,
      input.serviceId,
      input.buildId,
    );
    if (existing) {
      return existing;
    }

    const now = new Date();
    const build: Omit<Build, "_id"> = {
      accountId: input.accountId,
      serviceId: input.serviceId,
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
    serviceId: ObjectId,
    buildId: string,
  ): Promise<Build | null> {
    return this.collection.findOne({ accountId, serviceId, buildId });
  }

  async findByAccountAndService(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<Build[]> {
    return this.collection
      .find({ accountId, serviceId })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async updateDeploymentStatus(
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
    environment: string,
    status: DeploymentStatus,
  ): Promise<Build | null> {
    const log: DeploymentLogRecord = { environment, status };

    const result = await this.collection.findOneAndUpdate(
      { accountId, serviceId, buildId },
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

  async clearOtherDeployments(
    accountId: ObjectId,
    serviceId: ObjectId,
    excludeBuildId: string,
    environment: string,
  ): Promise<Build[]> {
    const activeStatuses = [
      DeploymentStatus.DEPLOYED,
      DeploymentStatus.DEPLOYING,
      DeploymentStatus.DISPATCHING,
    ];

    // Find affected builds before updating
    const affectedBuilds = await this.collection
      .find({
        accountId,
        serviceId,
        buildId: { $ne: excludeBuildId },
        [`deployments.${environment}`]: { $in: activeStatuses },
      })
      .toArray();

    if (affectedBuilds.length === 0) {
      return [];
    }

    const log: DeploymentLogRecord = {
      environment,
      status: DeploymentStatus.NONE,
    };

    await this.collection.updateMany(
      {
        accountId,
        serviceId,
        buildId: { $ne: excludeBuildId },
        [`deployments.${environment}`]: { $in: activeStatuses },
      },
      {
        $set: {
          [`deployments.${environment}`]: DeploymentStatus.NONE,
          updatedAt: new Date(),
        },
        $push: { deploymentLogs: log },
      },
    );

    return affectedBuilds;
  }

  async hasAnyDeployments(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<boolean> {
    // Check if any build has at least one deployment (non-empty deployments object)
    const buildWithDeployment = await this.collection.findOne({
      accountId,
      serviceId,
      $expr: { $gt: [{ $size: { $objectToArray: "$deployments" } }, 0] },
    });

    return buildWithDeployment !== null;
  }
}
