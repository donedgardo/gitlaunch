import { InstallationTokenService } from "./installationTokenService";

/**
 * Mock installation token service for e2e tests.
 * Returns a fake token - the MockGitHubApiClient ignores it anyway.
 */
export class MockInstallationTokenService
  implements Pick<InstallationTokenService, "getToken">
{
  async getToken(
    _installationId: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    return {
      token: "mock-installation-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    };
  }
}
