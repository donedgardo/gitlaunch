import EventEmitter from "node:events";
import { ObjectId } from "mongodb";
import { BuildRepository, Build } from "../../repositories/buildRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { DeploymentStatus } from "../service/deploymentStatus";
import { BuildDispatchServiceI } from "./buildDispatchService";

export type BuildUpdateEvent = {
  buildId: string;
  environment: string;
  status: DeploymentStatus;
  serviceId: string;
  serviceName: string;
  // Report-only (manual) services have no dispatch — their rows show status
  // without Deploy/Redeploy controls.
  canDispatch: boolean;
};

export type CreateBuildInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  buildId: string;
  message?: string;
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

    const build = await this.buildRepo.create({
      accountId: input.accountId,
      serviceId: input.serviceId,
      buildId: input.buildId,
      message: input.message,
    });

    // Emit event for SSE updates (used by setup page to detect first build,
    // and by the dashboard's new-build stream to render the row live —
    // include the message so that live row can show it too).
    this.eventEmitter.emit("build:created", {
      buildId: build.buildId,
      message: build.message,
      serviceId: input.serviceId.toString(),
      serviceName: service.name,
    });

    return build;
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

    // Auto-mark workflow as configured if not already
    if (!service.workflowConfigured) {
      await this.serviceRepo.markWorkflowConfigured(input.serviceId);
    }

    // Build SSE events
    const canDispatch = service.deployment != null;
    const updateEvent: BuildUpdateEvent = {
      buildId: build.buildId,
      environment: input.environment,
      status: input.status,
      serviceId: input.serviceId.toString(),
      serviceName: service.name,
      canDispatch,
    };

    const events: BuildUpdateEvent[] = [updateEvent];

    // Clear other builds' deployment status when a build is deployed
    if (input.status === DeploymentStatus.DEPLOYED) {
      const clearedBuilds = await this.buildRepo.clearOtherDeployments(
        input.accountId,
        input.serviceId,
        input.buildId,
        input.environment,
      );
      for (const clearedBuild of clearedBuilds) {
        events.push({
          buildId: clearedBuild.buildId,
          environment: input.environment,
          status: DeploymentStatus.NONE,
          serviceId: input.serviceId.toString(),
          serviceName: service.name,
          canDispatch,
        });
      }
    }

    // Emit event for SSE updates (as array for SSE listener compatibility)
    this.eventEmitter.emit("build:update", events);

    return build;
  }
}
