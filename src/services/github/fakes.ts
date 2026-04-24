import {
  IGitHubHttpClient,
  GitHubTokenResponse,
  GitHubUserResponse,
} from "../auth/githubOAuthService";
import {
  IGitHubApiClient,
  GitHubRepo,
  GitHubWorkflow,
} from "./githubAppService";
import {
  IGitHubAppClient,
  InstallationToken,
} from "./installationTokenService";

/**
 * Fake GitHub OAuth HTTP client for local development.
 * Accepts any authorization code and returns a dev user.
 */
export class FakeGitHubHttpClient implements IGitHubHttpClient {
  async exchangeCodeForToken(_code: string): Promise<GitHubTokenResponse> {
    return {
      access_token: "fake-dev-token",
      token_type: "bearer",
      scope: "user:email",
    };
  }

  async getUserInfo(_accessToken: string): Promise<GitHubUserResponse> {
    return {
      id: 1,
      login: "dev-user",
      email: "dev@localhost",
      name: "Dev User",
      avatar_url: null,
    };
  }
}

/**
 * Fake GitHub API client for local development.
 * Returns sample repos and workflows without calling GitHub.
 */
export class FakeGitHubApiClient implements IGitHubApiClient {
  async listInstallationRepos(_token: string): Promise<GitHubRepo[]> {
    return [
      {
        id: 100001,
        name: "public-repo-1",
        full_name: "test-org/public-repo-1",
        private: false,
        owner: { login: "test-org" },
      },
      {
        id: 100002,
        name: "public-repo-2",
        full_name: "test-org/public-repo-2",
        private: false,
        owner: { login: "test-org" },
      },
      {
        id: 100003,
        name: "private-repo",
        full_name: "test-org/private-repo",
        private: true,
        owner: { login: "test-org" },
      },
    ];
  }

  async listWorkflows(
    _token: string,
    _owner: string,
    _repo: string,
  ): Promise<GitHubWorkflow[]> {
    return [
      {
        id: 1,
        name: "CI",
        path: ".github/workflows/ci.yml",
        state: "active",
      },
      {
        id: 2,
        name: "Deploy",
        path: ".github/workflows/deploy.yml",
        state: "active",
      },
    ];
  }
}

/**
 * Fake GitHub App client for local development.
 * Returns a fake installation token without calling GitHub.
 */
export class FakeGitHubAppClient implements IGitHubAppClient {
  async getInstallationToken(
    _installationId: number,
  ): Promise<InstallationToken> {
    return {
      token: "fake-installation-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }
}
