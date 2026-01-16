import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import {
  GitHubAppClient,
  GitHubAppConfig,
  HttpClient,
} from "./githubAppClient";

// Generate a test RSA key pair at runtime
const { privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
});

// Fake HTTP client for testing
class FakeHttpClient implements HttpClient {
  public lastRequest: { url: string; options: RequestInit } | null = null;
  public responseToReturn = {
    token: "ghs_installation_token_from_github",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    this.lastRequest = { url, options: options ?? {} };

    return new Response(JSON.stringify(this.responseToReturn), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

describe("GitHubAppClient", () => {
  let fakeHttp: FakeHttpClient;
  let config: GitHubAppConfig;
  let client: GitHubAppClient;

  beforeEach(() => {
    fakeHttp = new FakeHttpClient();
    config = {
      appId: "12345",
      privateKey: TEST_PRIVATE_KEY,
    };
    client = new GitHubAppClient(config, fakeHttp);
  });

  describe("getInstallationToken", () => {
    it("should call GitHub API with JWT and return installation token", async () => {
      // Given: an installation ID
      const installationId = 98765;

      // When: I get the installation token
      const result = await client.getInstallationToken(installationId);

      // Then: I get back the token
      expect(result.token).toBe("ghs_installation_token_from_github");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("should call the correct GitHub API endpoint", async () => {
      // When: I get the installation token
      await client.getInstallationToken(12345);

      // Then: the correct endpoint was called
      expect(fakeHttp.lastRequest?.url).toBe(
        "https://api.github.com/app/installations/12345/access_tokens",
      );
    });

    it("should send JWT in Authorization header", async () => {
      // When: I get the installation token
      await client.getInstallationToken(12345);

      // Then: the Authorization header contains a JWT
      const authHeader = (
        fakeHttp.lastRequest?.options?.headers as Record<string, string>
      )?.["Authorization"];
      expect(authHeader).toMatch(/^Bearer eyJ/); // JWT starts with eyJ
    });

    it("should generate valid JWT with correct claims", async () => {
      // When: I get the installation token
      await client.getInstallationToken(12345);

      // Then: I can decode the JWT and verify claims
      const authHeader = (
        fakeHttp.lastRequest?.options?.headers as Record<string, string>
      )?.["Authorization"];
      const token = authHeader?.replace("Bearer ", "");

      // Decode without verification (we generated with test key)
      const decoded = jwt.decode(token!) as jwt.JwtPayload;

      expect(decoded.iss).toBe("12345"); // App ID
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
      // Token expires ~10 min from now (accounting for clock drift adjustment)
      const nowSeconds = Math.floor(Date.now() / 1000);
      expect(decoded.exp!).toBeGreaterThan(nowSeconds);
      expect(decoded.exp!).toBeLessThanOrEqual(nowSeconds + 600 + 60); // Max 10 min + clock buffer
    });
  });
});
