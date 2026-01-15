import { BuildStorageI } from "./interface";
import { BuildRecord } from "./buildRecord";
import { DeploymentStatus } from "../service/deploymentStatus";
import { DeploymentLogRecord } from "../service/deploymentLogsRecord";

export class BuildMockStorage implements BuildStorageI {
  private readonly builds: Record<string, BuildRecord>;

  constructor(builds: string[] = []) {
    this.builds = {};
    for (const build of builds) {
      this.builds[build] = {
        id: build,
        deployments: {},
        deploymentLogs: [],
        created_at: new Date(),
      };
    }
  }

  getBuilds(): Promise<BuildRecord[]> {
    return Promise.resolve(
      Object.values(this.builds).sort(
        (b1, b2) => b2.created_at.getTime() - b1.created_at.getTime(),
      ),
    );
  }

  create(buildId: string): Promise<BuildRecord> {
    if (this.builds[buildId]) {
      return Promise.resolve(this.builds[buildId]);
    }
    this.builds[buildId] = {
      id: buildId,
      deployments: {},
      deploymentLogs: [],
      created_at: new Date(),
    };
    return Promise.resolve(this.builds[buildId]);
  }

  getBuild(id: string): Promise<BuildRecord | null> {
    return Promise.resolve(this.builds[id] || null);
  }

  async updateDeploymentStatus(
    id: string,
    environment: string,
    status: DeploymentStatus,
  ): Promise<BuildRecord[]> {
    const build = await this.getBuild(id);
    if (!build) {
      return Promise.reject("No build found");
    }
    this.updateBuildEnvStatus(build, environment, status);
    this.createLog(environment, status, build);
    this.builds[id] = build;
    if (status === DeploymentStatus.DEPLOYED) {
      const updatedBuilds = this.removeOtherBuildsStatus(id, environment);
      return Promise.resolve([this.builds[id], ...updatedBuilds]);
    }
    return Promise.resolve([this.builds[id]]);
  }

  private updateBuildEnvStatus(
    build: BuildRecord,
    environment: string,
    status: DeploymentStatus,
  ) {
    build.deployments[environment] = status;
  }

  private createLog(
    environment: string,
    status: DeploymentStatus,
    build: BuildRecord,
  ) {
    const log: DeploymentLogRecord = { environment, status };
    build.deploymentLogs.push(log);
    return log;
  }

  private removeOtherBuildsStatus(buildId: string, environment: string) {
    const updatedBuilds = [];
    for (const id in this.builds) {
      if (buildId === id) continue;
      if (
        this.builds[id].deployments[environment] === DeploymentStatus.DEPLOYED
      ) {
        updatedBuilds.push(this.builds[id]);
        this.builds[id].deployments[environment] = DeploymentStatus.NONE;
      }
    }
    return updatedBuilds;
  }
}
