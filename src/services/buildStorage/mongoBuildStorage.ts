import { BuildStorageI } from "./interface";
import { BuildRecord } from "./buildRecord";
import { DeploymentStatus } from "../service/deploymentStatus";
import { DeploymentLogRecord } from "../service/deploymentLogsRecord";
import { Collection, Db, WithId } from "mongodb";

export class MongoBuildStorage implements BuildStorageI {
  private collection: Collection<BuildRecord>;

  constructor(db: Db, serviceName: string) {
    this.collection = db.collection(serviceName);
  }

  getBuilds(): Promise<BuildRecord[]> {
    return this.collection.find().sort({ created_at: -1 }).toArray();
  }

  async create(buildId: string): Promise<BuildRecord> {
    const existingBuild = await this.collection.findOne({ id: buildId });
    if (existingBuild) {
      return Promise.resolve(existingBuild);
    }
    const build = {
      id: buildId,
      deployments: {},
      deploymentLogs: [],
      created_at: new Date(),
    };
    await this.collection.insertOne(build);
    return build;
  }

  getBuild(id: string): Promise<BuildRecord | null> {
    return this.collection.findOne({ id });
  }

  async updateDeploymentStatus(
    id: string,
    environment: string,
    status: DeploymentStatus,
  ): Promise<BuildRecord[]> {
    const log: DeploymentLogRecord = { environment, status };
    const updatedBuild = (await this.collection.findOneAndUpdate(
      { id },
      {
        $set: { [`deployments.${environment}`]: status },
        $push: { deploymentLogs: log },
      },
      { returnDocument: "after" },
    )) as WithId<BuildRecord>;
    if (!updatedBuild) {
      return Promise.reject("No build found");
    }
    if (status === DeploymentStatus.DEPLOYED) {
      const updatedBuilds = await this.removeOtherBuildsStatus(id, environment);
      return Promise.resolve([updatedBuild, ...updatedBuilds]);
    }
    return Promise.resolve([updatedBuild]);
  }

  private async removeOtherBuildsStatus(buildId: string, environment: string) {
    const buildIdsToUpdate = await this.collection
      .find(
        {
          id: { $ne: buildId },
          [`deployments.${environment}`]: { $eq: DeploymentStatus.DEPLOYED },
        },
        {
          projection: { id: 1 },
        },
      )
      .map((build) => build.id)
      .toArray();

    await this.collection.updateMany(
      { id: { $in: buildIdsToUpdate } },
      { $set: { [`deployments.${environment}`]: DeploymentStatus.NONE } },
    );
    const updatedBuilds = await this.collection
      .find({
        id: { $in: buildIdsToUpdate },
      })
      .toArray();
    return updatedBuilds;
  }
}
