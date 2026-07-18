import { ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";

export type ConnectGithubInput = {
  accountId: ObjectId;
  installationId: number;
};

// Safe view for callers that need to know the connection exists and which
// installation backs it (e.g. minting tokens, showing status).
export type GithubConnectionView = {
  installationId: number;
  connected: true;
  connectedAt: Date;
};

/**
 * Owns the lifecycle of an account's GitHub App connection — the symmetric
 * counterpart to JenkinsConnectionService. The connection is stored on the
 * account aggregate as a GithubConnection value object; this service is the
 * one place that links, reads, and clears it.
 */
export class GithubConnectionService {
  constructor(private accountRepo: AccountRepository) {}

  async connect(input: ConnectGithubInput): Promise<void> {
    const account = await this.accountRepo.findById(input.accountId);
    if (!account) {
      throw new Error("Account not found");
    }
    await this.accountRepo.updateInstallation(
      input.accountId,
      input.installationId,
    );
  }

  async disconnect(accountId: ObjectId): Promise<void> {
    await this.accountRepo.clearGithubConnection(accountId);
  }

  async getView(accountId: ObjectId): Promise<GithubConnectionView | null> {
    const account = await this.accountRepo.findById(accountId);
    const connection = account?.githubConnection;
    if (!connection) {
      return null;
    }
    return {
      installationId: connection.installationId,
      connected: true,
      connectedAt: connection.connectedAt,
    };
  }

  async isConnected(accountId: ObjectId): Promise<boolean> {
    const account = await this.accountRepo.findById(accountId);
    return account?.githubConnection != null;
  }
}
