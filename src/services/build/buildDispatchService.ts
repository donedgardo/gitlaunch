import { ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import {
  MultiTenantGithubDispatchService,
  DispatchInput,
} from "../github/githubDispatchService";

export interface BuildDispatchServiceI {
  dispatch(
    accountId: ObjectId,
    repositoryId: ObjectId,
    buildId: string,
    environment: string,
  ): Promise<void>;
}

export class BuildDispatchService implements BuildDispatchServiceI {
  constructor(
    private accountRepo: AccountRepository,
    private repoRepo: RepositoryRepository,
    private githubDispatch: MultiTenantGithubDispatchService,
  ) {}

  async dispatch(
    accountId: ObjectId,
    repositoryId: ObjectId,
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

    // Look up repository to get GitHub details
    const repository = await this.repoRepo.findById(repositoryId);
    if (!repository) {
      throw new Error("Repository not found");
    }

    const input: DispatchInput = {
      installationId: account.githubInstallationId,
      owner: repository.githubOwner,
      repo: repository.githubRepoName,
      eventType: repository.eventType,
      buildId,
      environment,
    };

    await this.githubDispatch.dispatch(input);
  }
}

// No-op implementation for testing
export class NoOpBuildDispatchService implements BuildDispatchServiceI {
  async dispatch(): Promise<void> {
    // No-op
  }
}
