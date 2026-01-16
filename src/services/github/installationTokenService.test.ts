import { describe, it, expect, beforeEach } from "vitest";
import {
  InstallationTokenService,
  IGitHubAppClient,
  InstallationToken,
} from "./installationTokenService";

// Fake GitHub App client for testing
class FakeGitHubAppClient implements IGitHubAppClient {
  public callCount = 0;
  public tokenToReturn: InstallationToken = {
    token: "ghs_fake_token_123",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
  };

  async getInstallationToken(
    installationId: number,
  ): Promise<InstallationToken> {
    this.callCount++;
    return this.tokenToReturn;
  }
}

describe("InstallationTokenService", () => {
  let fakeClient: FakeGitHubAppClient;
  let service: InstallationTokenService;

  beforeEach(() => {
    fakeClient = new FakeGitHubAppClient();
    service = new InstallationTokenService(fakeClient);
  });

  describe("getToken", () => {
    it("should return a valid installation token", async () => {
      // Given: an installation ID
      const installationId = 12345;

      // When: I get the token
      const result = await service.getToken(installationId);

      // Then: I get a valid token
      expect(result.token).toBe("ghs_fake_token_123");
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("should return cached token when called twice within expiry", async () => {
      // Given: I've already fetched a token
      const installationId = 12345;
      await service.getToken(installationId);

      // When: I get the token again
      await service.getToken(installationId);

      // Then: GitHub was only called once (token was cached)
      expect(fakeClient.callCount).toBe(1);
    });

    it("should fetch fresh token after cached one expires", async () => {
      // Given: I have a token that expires very soon
      fakeClient.tokenToReturn = {
        token: "ghs_expiring_soon",
        expiresAt: new Date(Date.now() + 1000), // Expires in 1 second
      };
      const installationId = 12345;
      await service.getToken(installationId);

      // When: time passes and token is near expiry (within 5 min buffer)
      fakeClient.tokenToReturn = {
        token: "ghs_fresh_token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };

      // Simulate time passing - token is now expired
      // The service should detect this and fetch fresh
      const result = await service.getToken(installationId);

      // Then: A fresh token was fetched
      expect(result.token).toBe("ghs_fresh_token");
      expect(fakeClient.callCount).toBe(2);
    });

    it("should cache tokens per installation ID", async () => {
      // Given: two different installations
      const installation1 = 111;
      const installation2 = 222;

      // When: I get tokens for both
      await service.getToken(installation1);
      await service.getToken(installation2);

      // Then: GitHub was called twice (separate caches)
      expect(fakeClient.callCount).toBe(2);

      // And getting the same installation again uses cache
      await service.getToken(installation1);
      expect(fakeClient.callCount).toBe(2);
    });
  });
});
