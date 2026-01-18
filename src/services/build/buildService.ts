import EventEmitter from "node:events";
import { ObjectId } from "mongodb";
import { BuildRepository, Build } from "../../repositories/buildRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { DeploymentStatus } from "../service/deploymentStatus";
import { IDispatchService } from "../service/IDispatchService";

export type CreateBuildInput = {
  accountId: ObjectId;
  repositoryId: ObjectId;
  buildId: string;
};

export type UpdateDeploymentStatusInput = {
  accountId: ObjectId;
  repositoryId: ObjectId;
  buildId: string;
  environment: string;
  status: DeploymentStatus;
};

export class BuildService {
  constructor(
    private buildRepo: BuildRepository,
    private repoRepo: RepositoryRepository,
    private eventEmitter: EventEmitter,
    private dispatcher: IDispatchService,
  ) {}

  async createBuild(input: CreateBuildInput): Promise<Build> {
    // Validate repository exists and belongs to account
    const repository = await this.repoRepo.findById(input.repositoryId);
    if (!repository) {
      throw new Error("Repository not found");
    }
    if (repository.accountId.toString() !== input.accountId.toString()) {
      throw new Error("Repository does not belong to this account");
    }

    return this.buildRepo.create({
      accountId: input.accountId,
      repositoryId: input.repositoryId,
      buildId: input.buildId,
    });
  }

  async getBuild(
    accountId: ObjectId,
    repositoryId: ObjectId,
    buildId: string,
  ): Promise<Build | null> {
    return this.buildRepo.findByBuildId(accountId, repositoryId, buildId);
  }

  async getBuilds(
    accountId: ObjectId,
    repositoryId: ObjectId,
  ): Promise<Build[]> {
    return this.buildRepo.findByAccountAndRepo(accountId, repositoryId);
  }

  async updateDeploymentStatus(
    input: UpdateDeploymentStatusInput,
  ): Promise<Build> {
    // Validate repository exists to get valid environments
    const repository = await this.repoRepo.findById(input.repositoryId);
    if (!repository) {
      throw new Error("Repository not found");
    }

    // Validate environment
    const validEnvironments = repository.environments.map((e) => e.name);
    if (!validEnvironments.includes(input.environment)) {
      throw new Error("Invalid environment");
    }

    // Validate status
    if (!Object.values(DeploymentStatus).includes(input.status)) {
      throw new Error("Invalid deployment status");
    }

    // Trigger dispatch if status is DISPATCHING
    if (input.status === DeploymentStatus.DISPATCHING) {
      await this.dispatcher.dispatch(input.environment, input.buildId);
    }

    // Update the build
    const build = await this.buildRepo.updateDeploymentStatus(
      input.accountId,
      input.repositoryId,
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
      repositoryId: input.repositoryId.toString(),
    });

    return build;
  }
}
