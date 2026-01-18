import { http, HttpResponse } from "msw";

/**
 * MSW handlers for mocking external APIs during e2e tests.
 * These intercept real HTTP requests at the network level,
 * allowing us to test the production server with controlled external dependencies.
 */

// Mock GitHub repos for testing plan enforcement
const mockRepos = [
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

export const handlers = [
  // Mock GitHub App installation repos endpoint
  http.get("https://api.github.com/installation/repositories", () => {
    return HttpResponse.json({
      total_count: mockRepos.length,
      repositories: mockRepos,
    });
  }),

  // Mock GitHub App access token endpoint (used by InstallationTokenService)
  http.post(
    "https://api.github.com/app/installations/:installationId/access_tokens",
    () => {
      return HttpResponse.json({
        token: "ghs_mock_installation_token",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    },
  ),
];
