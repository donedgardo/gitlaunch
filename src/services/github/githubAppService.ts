import { ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { InstallationTokenService } from "./installationTokenService";

export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: { login: string };
};

export type GitHubWorkflow = {
  id: number;
  name: string;
  path: string;
  state: string;
};

export interface IGitHubApiClient {
  listInstallationRepos(token: string): Promise<GitHubRepo[]>;
  listWorkflows(
    token: string,
    owner: string,
    repo: string,
  ): Promise<GitHubWorkflow[]>;
}

export class GitHubAppService {
  constructor(
    private accountRepo: AccountRepository,
    private tokenService?: InstallationTokenService,
    private apiClient?: IGitHubApiClient,
  ) {}

  async listInstallationRepos(accountId: ObjectId): Promise<GitHubRepo[]> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    if (!account.githubConnection) {
      throw new Error("Account does not have a GitHub App installation");
    }

    if (!this.tokenService || !this.apiClient) {
      throw new Error(
        "Token service and API client required for listing repos",
      );
    }

    const { token } = await this.tokenService.getToken(
      account.githubConnection.installationId,
    );
    return this.apiClient.listInstallationRepos(token);
  }

  async listRepositoryWorkflows(
    accountId: ObjectId,
    owner: string,
    repo: string,
  ): Promise<GitHubWorkflow[]> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    if (!account.githubConnection) {
      throw new Error("Account does not have a GitHub App installation");
    }

    if (!this.tokenService || !this.apiClient) {
      throw new Error(
        "Token service and API client required for listing workflows",
      );
    }

    const { token } = await this.tokenService.getToken(
      account.githubConnection.installationId,
    );
    return this.apiClient.listWorkflows(token, owner, repo);
  }
}
