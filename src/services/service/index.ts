import EventEmitter from "node:events";
import { ServiceI } from "./interface";
import { BuildStorageI } from "../buildStorage/interface";
import { BuildRecord } from "../buildStorage/buildRecord";
import { DeploymentStatus } from "./deploymentStatus";
import { DeploymentLogRecord } from "./deploymentLogsRecord";
import { EnvironmentDeploymentsStatuses } from "./BuildDeploymentStatuses";
import { BuildUpdateEvent } from "./buildUpdateEvent";
import { IDispatchService } from "./IDispatchService";

export class Service implements ServiceI {
  private storage: BuildStorageI;
  private readonly name: string;
  private readonly environments: string[];
  private eventEmitter: EventEmitter;
  private readonly dispatcher: IDispatchService;

  constructor(
    name: string,
    storage: BuildStorageI,
    eventEmitter: EventEmitter,
    dispatcher: IDispatchService,
    environments: string[] = [],
  ) {
    this.name = name;
    this.storage = storage;
    this.eventEmitter = eventEmitter;
    this.environments = environments;
    this.dispatcher = dispatcher;
  }

  getName(): string {
    return this.name;
  }

  async getBuilds() {
    return this.storage.getBuilds();
  }

  async create(buildId: string): Promise<BuildRecord> {
    return this.storage.create(buildId);
  }

  async findOne(id: string) {
    return this.storage.getBuild(id);
  }

  getEnvironments(): string[] {
    return this.environments;
  }

  async updateDeploymentStatus(
    id: string,
    environment: string,
    status: DeploymentStatus,
  ): Promise<BuildRecord> {
    if (!this.environments.includes(environment)) {
      return Promise.reject("Invalid environment");
    }
    if (!Object.values(DeploymentStatus).includes(status)) {
      return Promise.reject("Invalid Deployment Status");
    }
    if (status === DeploymentStatus.DISPATCHING) {
      await this.dispatcher.dispatch(environment, id);
    }
    const builds = await this.storage.updateDeploymentStatus(
      id,
      environment,
      status,
    );
    const eventPayloads: BuildUpdateEvent[] = builds.map((build) => ({
      buildId: build.id,
      environment,
      status: build.deployments[environment],
      serviceName: this.getName(),
    }));
    this.eventEmitter.emit("build:update", eventPayloads);
    return builds[0];
  }

  async getDeploymentStatus(
    buildId: string,
  ): Promise<EnvironmentDeploymentsStatuses> {
    const build = await this.storage.getBuild(buildId);
    if (!build) {
      return Promise.reject("No build found.");
    }
    return Promise.resolve(build.deployments);
  }

  async getDeploymentsLogs(buildId: string): Promise<DeploymentLogRecord[]> {
    const build = await this.storage.getBuild(buildId);
    if (!build) {
      return Promise.reject("No build found.");
    }
    return Promise.resolve(build.deploymentLogs);
  }
}
