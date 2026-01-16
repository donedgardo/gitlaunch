export type InstallationToken = {
  token: string;
  expiresAt: Date;
};

export interface GitHubAppClient {
  getInstallationToken(installationId: number): Promise<InstallationToken>;
}

// Buffer time before expiry to refresh token (5 minutes)
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class InstallationTokenService {
  private cache: Map<number, InstallationToken> = new Map();

  constructor(private client: GitHubAppClient) {}

  async getToken(installationId: number): Promise<InstallationToken> {
    const cached = this.cache.get(installationId);

    if (cached && !this.isExpired(cached)) {
      return cached;
    }

    const token = await this.client.getInstallationToken(installationId);
    this.cache.set(installationId, token);
    return token;
  }

  private isExpired(token: InstallationToken): boolean {
    return token.expiresAt.getTime() - EXPIRY_BUFFER_MS <= Date.now();
  }
}
