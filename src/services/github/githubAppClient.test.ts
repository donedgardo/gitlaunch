import { describe, it, expect, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import {
  RealGitHubAppClient,
  GitHubAppConfig,
  HttpClient,
} from "./githubAppClient";

// Test RSA key pair (generated for testing only - DO NOT use in production)
const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAztF4eacz5Vh4i4dol+hPae+5qttJ4KvkHURTrVaWNxyCoVaK
VajUnU30L/WPCsM+vzvf/9y0HJXQYZaNXe5/i37b+F/xamBHF3ms0svGrkTZFwoH
0/eiwddzYsjBYSJW5+N5mRI8bjYQ0MTQmLiwYrKmuwNzomNOI1qBqMz2CCdCBTIH
XbwSrP1+p3lC7+ARL48MwawRbvXaICxxmgSaOeiL2AafhmaIvuqdSBF2R9icDgNN
+eoAsV2C+rMN3rTIkGZMZxnoVJDYiHtCMoXKLSenin8Yl2trfV1YyhojYElKw++9
UiCHscWgzV9A8dDvt/zU+34TxlgpElXVmHYP+QIDAQABAoIBAFKe4dcPka7MYhOz
e3g8CQWUDAMSaXgEkzOR6S+1CHtpu1HCpa7ErHNPAf7qxUMSbo2s2LZ5L8a/nqht
oXnl3jQW8L9PbL0HSz84j28CkxNpU6RdkHUAV5fCf0j2VDJ+qmMmv5wD6fpJRPxx
s7dfCK/VGMBbB6XWsA91h5iskJj+hbAvSxp5+FTR72gCky+u0SQzvqahfgTcr9PZ
aVAZAf3u0p/oTiSCUrmPdgy9NKvKgwByQibUvxjQla1UZWarrJv57OMfzStHO11J
eq+yYQAIeS6wUFmwThL2aOii/pec60TwVyVHhSUe5pswuMSN2aoO6QWcYVS4zrjo
WCRIUJECgYEA9PCDISuhkNfM69KScwX1ZFGBrhCi8d3zvz5gbdXZi207UAN5Uh1q
oqisSLaFQqQqFJa1s4w3iJRADvVWUpp4tBjSTvt7nScrqFqIrsvj9vOtGFW9ivgS
B0i3ierVKnIwgOvhgVbQZG0AkF/A38PpsMHoZRjOPziKjy7Rcy8Nux0CgYEA2ChH
VjI127wJtBZit9ZrTsNPbptJq/7tMVZH6UXBBf1zmyPQVKXPEuGlNZlyI5z2YWt/
mj3po0nLUoCkwm7nz0fimOa1OGwUIaJn88Ceg2bpseqsJgsO4n8r5+7TyfDAYEz8
WW/e/c1yh7DKeCo1/xn6tcsvqOTOoh1pmg19NY0CgYAg2C99PzCHD6j25mGk8uOY
9CUDhk+TR0PsHR0pHUfynk8Zx515GWC3Nw8DIRZ1fTX3VM5AqUi5E8gTOWq94ODW
pY1t8eL9i8ca6Cjz53tGHh7T6ItmGyWvvFyALfEvo+hFIVw3z8BZ9xPgSDbAyrCH
dzkGdXESoS5TTN/hJiodMQKBgFj1Ap6znTyn/ypRCCF2KcVJVbhESiZxjHYAdynG
XjCz5M7VB1i+wCCaIl6TnsiPQUpIbkQw9KURqo5yiNvHvriscdHRKIVm3UYWS0ei
XtnfEY/57wzdAiwugAg8Xoa+AL3hEP1Rr+itk1PKaxjW7k/lBiuoyh1sxKktB5ex
s3TFAoGBAKVVyb3i1oxQyRvjZ3AjxwWkg/7gexiGd9ylQ8XCoeFyfM2WO4eslzo7
MSmc7otDd1hU0EaJQtJddqYLS2MELEDJ/5FyAzJAEd/Q1nkRbzaYiBHJwwPlLHeA
QRKQHGzUsos7YLarflnC1Hk02dmLBovGGhKMrtLGEyekRBFa1rjb
-----END RSA PRIVATE KEY-----`;

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

describe("RealGitHubAppClient", () => {
  let fakeHttp: FakeHttpClient;
  let config: GitHubAppConfig;
  let client: RealGitHubAppClient;

  beforeEach(() => {
    fakeHttp = new FakeHttpClient();
    config = {
      appId: "12345",
      privateKey: TEST_PRIVATE_KEY,
    };
    client = new RealGitHubAppClient(config, fakeHttp);
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
