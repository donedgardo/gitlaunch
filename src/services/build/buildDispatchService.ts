import { ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import {
  MultiTenantGithubDispatchService,
  DispatchInput,
} from "../github/githubDispatchService";

export interface BuildDispatchServiceI {
  dispatch(
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
    environment: string,
  ): Promise<void>;
}

export class BuildDispatchService implements BuildDispatchServiceI {
  constructor(
    private accountRepo: AccountRepository,
    private repoRepo: RepositoryRepository,
    private serviceRepo: ServiceRepository,
    private githubDispatch: MultiTenantGithubDispatchService,
  ) {}

  async dispatch(
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
    environment: string,
  ): Promise<void> {
    // Look up account to get GitHub installation ID
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }
    if (!account.githubInstallationId) {
      throw new Error("GitHub App not installed for this account");
    }

    // Look up service to get workflow config
    const service = await this.serviceRepo.findById(serviceId);
    if (!service) {
      throw new Error("Service not found");
    }

    // Look up repository to get GitHub details
    const repository = await this.repoRepo.findById(service.repositoryId);
    if (!repository) {
      throw new Error("Repository not found");
    }

    const input: DispatchInput = {
      installationId: account.githubInstallationId,
      owner: repository.githubOwner,
      repo: repository.githubRepoName,
      workflowFile: service.workflowFile,
      buildId,
      environment,
      serviceId: serviceId.toString(),
    };

    await this.githubDispatch.dispatch(input);
  }
}

// No-op implementation for testing
export class NoOpBuildDispatchService implements BuildDispatchServiceI {
  async dispatch(
    _accountId: ObjectId,
    _serviceId: ObjectId,
    _buildId: string,
    _environment: string,
  ): Promise<void> {
    // No-op
  }
}
