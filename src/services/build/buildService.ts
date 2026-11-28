import EventEmitter from "node:events";
import { ObjectId } from "mongodb";
import { BuildRepository, Build } from "../../repositories/buildRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { DeploymentStatus } from "../service/deploymentStatus";
import { BuildDispatchServiceI } from "./buildDispatchService";
import {
  DeploymentIntent,
  deriveIntent,
  intentInFlight,
} from "../dispatch/deploymentIntent";
import { Actor, describeActor, shippedBy } from "../service/actor";

export type BuildUpdateEvent = {
  buildId: string;
  environment: string;
  status: DeploymentStatus;
  accountId: string;
  serviceId: string;
  serviceName: string;
  // When this build went live in the environment, so a pushed cell keeps the
  // "how long ago" label the full page render shows. Absent unless live.
  deployedAt?: Date;
  // Who shipped the build that is now live, as the board prints it. Absent
  // unless live, and for deploys dispatched before attribution existed.
  deployedBy?: string;
  // Report-only (manual) services have no dispatch — their rows show status
  // without Deploy/Redeploy controls.
  canDispatch: boolean;
};

export type CreateBuildInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  buildId: string;
  message?: string;
  /** When the change was authored, so lead time is commit-to-live. */
  commitAt?: Date;
};

export type UpdateDeploymentStatusInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  buildId: string;
  environment: string;
  status: DeploymentStatus;
  // Who is making this change. Required so that no path into a deployment —
  // dashboard, API or MCP — can change one anonymously.
  actor: Actor;
  // Why, in the actor's own words, when they said.
  reason?: string;
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
      commitAt: input.commitAt,
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

    // Decide why this build is going out before anything changes. Only a
    // dispatch that starts here can be classified — the alternative is
    // inferring rollbacks from git after the fact, which is the guesswork
    // that makes change failure rate and time to restore untrustworthy
    // everywhere else.
    const intent = await this.resolveIntent(input);

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
      intent,
      { actor: input.actor, reason: input.reason },
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
      accountId: input.accountId.toString(),
      serviceId: input.serviceId.toString(),
      serviceName: service.name,
      deployedAt: build.deployedAt?.[input.environment],
      deployedBy: whoShipped(build, input.environment, input.status),
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
          accountId: input.accountId.toString(),
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

  /**
   * Classify a deployment as a promote or a rollback.
   *
   * Decided fresh when the build is dispatched (compare it against whatever
   * is live in that environment); inherited from that dispatch for every
   * status that follows, so the entry marking service restored carries it
   * too.
   */
  private async resolveIntent(
    input: UpdateDeploymentStatusInput,
  ): Promise<DeploymentIntent | undefined> {
    const build = await this.buildRepo.findByBuildId(
      input.accountId,
      input.serviceId,
      input.buildId,
    );
    if (!build) {
      return undefined;
    }

    if (input.status !== DeploymentStatus.DISPATCHING) {
      // Builds stored before deployment history existed have no log at all.
      return intentInFlight(build.deploymentLogs ?? [], input.environment);
    }

    const current = await this.buildRepo.findLastDeployed(
      input.accountId,
      input.serviceId,
      input.environment,
    );

    return deriveIntent({
      target: { buildId: build.buildId, createdAt: build.createdAt },
      current: current
        ? { buildId: current.buildId, createdAt: current.createdAt }
        : null,
    });
  }
}

// The board's "by …" label for a live build; nothing to say until it is live.
function whoShipped(
  build: Build,
  environment: string,
  status: DeploymentStatus,
): string | undefined {
  if (status !== DeploymentStatus.DEPLOYED) return undefined;
  const actor = shippedBy(build.deploymentLogs, environment);
  return actor ? describeActor(actor) : undefined;
}
