export type GitHubTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
};

export type GitHubUserResponse = {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
};

// Interface for HTTP client - allows injection of real or fake implementation
export interface GitHubHttpClient {
  exchangeCodeForToken(code: string): Promise<GitHubTokenResponse>;
  getUserInfo(accessToken: string): Promise<GitHubUserResponse>;
}

export type GitHubOAuthConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
};

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

export class GitHubOAuthService {
  private httpClient: GitHubHttpClient;
  private config: GitHubOAuthConfig;

  constructor(httpClient: GitHubHttpClient, config: GitHubOAuthConfig = {}) {
    this.httpClient = httpClient;
    this.config = config;
  }

  async exchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
    return this.httpClient.exchangeCodeForToken(code);
  }

  async getUserInfo(accessToken: string): Promise<GitHubUserResponse> {
    return this.httpClient.getUserInfo(accessToken);
  }

  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId ?? "",
      redirect_uri: this.config.redirectUri ?? "",
      scope: "user:email",
    });

    if (state) {
      params.set("state", state);
    }

    return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
  }
}

// Real HTTP client implementation for production
export class RealGitHubHttpClient implements GitHubHttpClient {
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async exchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
        }),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to exchange code for token");
    }

    const data = (await response.json()) as
      | GitHubTokenResponse
      | { error: string; error_description?: string };
    if ("error" in data) {
      throw new Error(data.error_description || "Invalid authorization code");
    }

    return data;
  }

  async getUserInfo(accessToken: string): Promise<GitHubUserResponse> {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new Error("Invalid access token");
    }

    return response.json() as Promise<GitHubUserResponse>;
  }
}
