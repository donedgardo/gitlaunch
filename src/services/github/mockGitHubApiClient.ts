import { GitHubApiClient, GitHubRepo } from "./githubAppService";

/**
 * Mock GitHub API client for e2e tests.
 * Returns predefined repos based on the installation context.
 * Used when E2E_TEST_MODE environment variable is set.
 */
export class MockGitHubApiClient implements GitHubApiClient {
  // Mock repos for e2e tests - mapped by what would be reasonable test scenarios
  private readonly mockRepos: GitHubRepo[] = [
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

  async listInstallationRepos(_token: string): Promise<GitHubRepo[]> {
    // Return all mock repos - the plan enforcement tests will verify
    // that users cannot select more repos than their plan allows
    return this.mockRepos;
  }
}
