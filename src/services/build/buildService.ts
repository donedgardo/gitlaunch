import EventEmitter from "node:events";
import { ObjectId } from "mongodb";
import { BuildRepository, Build } from "../../repositories/buildRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { DeploymentStatus } from "../service/deploymentStatus";
import { BuildDispatchServiceI } from "./buildDispatchService";

export type CreateBuildInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  buildId: string;
};

export type UpdateDeploymentStatusInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  buildId: string;
  environment: string;
  status: DeploymentStatus;
};

export class BuildService {
  constructor(
    private buildRepo: BuildRepository,
    private serviceRepo: ServiceRepository,
    private eventEmitter: EventEmitter,
    private dispatcher: BuildDispatchServiceI,
  ) {}

  async createBuild(input: CreateBuildInput): Promise<Build> {
    // Validate service exists and belongs to account
    const service = await this.serviceRepo.findById(input.serviceId);
    if (!service) {
      throw new Error("Service not found");
    }
    if (service.accountId.toString() !== input.accountId.toString()) {
      throw new Error("Service does not belong to this account");
    }

    return this.buildRepo.create({
      accountId: input.accountId,
      serviceId: input.serviceId,
      buildId: input.buildId,
    });
  }

  async getBuild(
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
  ): Promise<Build | null> {
    return this.buildRepo.findByBuildId(accountId, serviceId, buildId);
  }

  async getBuilds(accountId: ObjectId, serviceId: ObjectId): Promise<Build[]> {
    return this.buildRepo.findByAccountAndService(accountId, serviceId);
  }

  async updateDeploymentStatus(
    input: UpdateDeploymentStatusInput,
  ): Promise<Build> {
    // Validate service exists to get valid environments
    const service = await this.serviceRepo.findById(input.serviceId);
    if (!service) {
      throw new Error("Service not found");
    }

    // Validate environment
    const validEnvironments = service.environments.map((e) => e.name);
    if (!validEnvironments.includes(input.environment)) {
      throw new Error("Invalid environment");
    }

    // Validate status
    if (!Object.values(DeploymentStatus).includes(input.status)) {
      throw new Error("Invalid deployment status");
    }

    // Trigger dispatch if status is DISPATCHING
    if (input.status === DeploymentStatus.DISPATCHING) {
      await this.dispatcher.dispatch(
        input.accountId,
        input.serviceId,
        input.buildId,
        input.environment,
      );
    }

    // Update the build
    const build = await this.buildRepo.updateDeploymentStatus(
      input.accountId,
      input.serviceId,
      input.buildId,
      input.environment,
      input.status,
    );

    if (!build) {
      throw new Error("Build not found");
    }

    // Emit event for SSE updates
    this.eventEmitter.emit("build:update", {
      buildId: build.buildId,
      environment: input.environment,
      status: input.status,
      serviceId: input.serviceId.toString(),
    });

    return build;
  }
}
