import jwt from "jsonwebtoken";
import {
  IGitHubAppClient,
  InstallationToken,
} from "./installationTokenService";

export type GitHubAppConfig = {
  appId: string;
  privateKey: string;
};

export interface HttpClient {
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

// Default HTTP client using global fetch
export class DefaultHttpClient implements HttpClient {
  fetch(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, options);
  }
}

type GitHubInstallationTokenResponse = {
  token: string;
  expires_at: string;
};

export class GitHubAppClient implements IGitHubAppClient {
  private config: GitHubAppConfig;
  private http: HttpClient;

  constructor(config: GitHubAppConfig, http?: HttpClient) {
    this.config = config;
    this.http = http ?? new DefaultHttpClient();
  }

  async getInstallationToken(
    installationId: number,
  ): Promise<InstallationToken> {
    const appJwt = this.generateAppJwt();

    const response = await this.http.fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get installation token: ${error}`);
    }

    const data = (await response.json()) as GitHubInstallationTokenResponse;

    return {
      token: data.token,
      expiresAt: new Date(data.expires_at),
    };
  }

  private generateAppJwt(): string {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iat: now - 60, // Issued 60 seconds ago (clock drift)
      exp: now + 600, // Expires in 10 minutes
      iss: this.config.appId,
    };

    return jwt.sign(payload, this.config.privateKey, { algorithm: "RS256" });
  }
}
