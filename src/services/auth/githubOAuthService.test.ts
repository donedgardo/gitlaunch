import { describe, it, expect, beforeEach } from "vitest";
import {
  GitHubOAuthService,
  IGitHubHttpClient,
  GitHubTokenResponse,
  GitHubUserResponse,
} from "./githubOAuthService";

// Fake implementation for testing - tests behavior, not HTTP details
class FakeGitHubHttpClient implements IGitHubHttpClient {
  private tokenResponses: Map<string, GitHubTokenResponse> = new Map();
  private userResponses: Map<string, GitHubUserResponse> = new Map();

  // Setup methods for tests
  setTokenResponse(code: string, response: GitHubTokenResponse) {
    this.tokenResponses.set(code, response);
  }

  setUserResponse(token: string, response: GitHubUserResponse) {
    this.userResponses.set(token, response);
  }

  // Interface implementation
  async exchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
    const response = this.tokenResponses.get(code);
    if (!response) {
      throw new Error("Invalid authorization code");
    }
    return response;
  }

  async getUserInfo(accessToken: string): Promise<GitHubUserResponse> {
    const response = this.userResponses.get(accessToken);
    if (!response) {
      throw new Error("Invalid access token");
    }
    return response;
  }
}

describe("GitHubOAuthService", () => {
  let service: GitHubOAuthService;
  let fakeClient: FakeGitHubHttpClient;

  beforeEach(() => {
    fakeClient = new FakeGitHubHttpClient();
    service = new GitHubOAuthService(fakeClient);
  });

  describe("exchangeCodeForToken", () => {
    it("should return access token when code is valid", async () => {
      // Given: GitHub will return a token for code "valid-code"
      fakeClient.setTokenResponse("valid-code", {
        access_token: "gho_abc123",
        token_type: "bearer",
        scope: "user:email",
      });

      // When: I exchange the code
      const result = await service.exchangeCodeForToken("valid-code");

      // Then: I get the access token
      expect(result.access_token).toBe("gho_abc123");
    });

    it("should throw error when code is invalid", async () => {
      // When: I exchange an invalid code
      // Then: it throws
      await expect(
        service.exchangeCodeForToken("invalid-code"),
      ).rejects.toThrow("Invalid authorization code");
    });
  });

  describe("getUserInfo", () => {
    it("should return user profile when token is valid", async () => {
      // Given: GitHub will return user info for token
      fakeClient.setUserResponse("valid-token", {
        id: 12345,
        login: "octocat",
        email: "octocat@github.com",
        name: "The Octocat",
        avatar_url: "https://github.com/images/octocat.png",
      });

      // When: I fetch user info
      const user = await service.getUserInfo("valid-token");

      // Then: I get the user profile
      expect(user.id).toBe(12345);
      expect(user.login).toBe("octocat");
      expect(user.email).toBe("octocat@github.com");
      expect(user.name).toBe("The Octocat");
      expect(user.avatar_url).toBe("https://github.com/images/octocat.png");
    });

    it("should handle null email (private email setting)", async () => {
      // Given: GitHub returns null email for private email users
      fakeClient.setUserResponse("private-email-token", {
        id: 99999,
        login: "privateuser",
        email: null,
        name: "Private User",
        avatar_url: null,
      });

      // When: I fetch user info
      const user = await service.getUserInfo("private-email-token");

      // Then: email is null
      expect(user.email).toBeNull();
    });

    it("should throw error when token is invalid", async () => {
      // When: I fetch with invalid token
      // Then: it throws
      await expect(service.getUserInfo("bad-token")).rejects.toThrow(
        "Invalid access token",
      );
    });
  });

  describe("getAuthorizationUrl", () => {
    it("should return GitHub OAuth URL with client_id and redirect_uri", () => {
      // Given: service configured with client ID and redirect URI
      const configuredService = new GitHubOAuthService(fakeClient, {
        clientId: "my-client-id",
        redirectUri: "https://myapp.com/auth/github/callback",
      });

      // When: I get the authorization URL
      const url = configuredService.getAuthorizationUrl();

      // Then: it includes the required params
      expect(url).toContain("https://github.com/login/oauth/authorize");
      expect(url).toContain("client_id=my-client-id");
      expect(url).toContain(
        "redirect_uri=https%3A%2F%2Fmyapp.com%2Fauth%2Fgithub%2Fcallback",
      );
      expect(url).toContain("scope=user%3Aemail");
    });

    it("should include state parameter for CSRF protection", () => {
      // Given: service with a state value
      const configuredService = new GitHubOAuthService(fakeClient, {
        clientId: "my-client-id",
        redirectUri: "https://myapp.com/callback",
      });

      // When: I get the authorization URL with state
      const url = configuredService.getAuthorizationUrl("my-csrf-state");

      // Then: state is included
      expect(url).toContain("state=my-csrf-state");
    });
  });
});
