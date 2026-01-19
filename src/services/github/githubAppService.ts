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

export interface IGitHubApiClient {
  listInstallationRepos(token: string): Promise<GitHubRepo[]>;
}

export class GitHubAppService {
  constructor(
    private accountRepo: AccountRepository,
    private tokenService?: InstallationTokenService,
    private apiClient?: IGitHubApiClient,
  ) {}

  async linkInstallation(
    accountId: ObjectId,
    installationId: number,
  ): Promise<void> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    await this.accountRepo.updateInstallation(accountId, installationId);
  }

  async hasInstallation(accountId: ObjectId): Promise<boolean> {
    const account = await this.accountRepo.findById(accountId);
    return account?.githubInstallationId !== null;
  }

  async listInstallationRepos(accountId: ObjectId): Promise<GitHubRepo[]> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    if (!account.githubInstallationId) {
      throw new Error("Account does not have a GitHub App installation");
    }

    if (!this.tokenService || !this.apiClient) {
      throw new Error(
        "Token service and API client required for listing repos",
      );
    }

    const { token } = await this.tokenService.getToken(
      account.githubInstallationId,
    );
    return this.apiClient.listInstallationRepos(token);
  }
}
