import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { registerGitHubAuthRoutes } from "./github";
import {
  GitHubOAuthService,
  GitHubHttpClient,
  GitHubTokenResponse,
  GitHubUserResponse,
} from "../../../services/auth/githubOAuthService";
import { SessionService } from "../../../services/auth/sessionService";
import { UserRepository } from "../../../repositories/userRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";

// Fake GitHub HTTP client for testing
class FakeGitHubHttpClient implements GitHubHttpClient {
  private tokenResponses: Map<string, GitHubTokenResponse> = new Map();
  private userResponses: Map<string, GitHubUserResponse> = new Map();

  setTokenResponse(code: string, response: GitHubTokenResponse) {
    this.tokenResponses.set(code, response);
  }

  setUserResponse(token: string, response: GitHubUserResponse) {
    this.userResponses.set(token, response);
  }

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

describe("GitHub OAuth Routes", () => {
  let app: FastifyInstance;
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let fakeGitHubClient: FakeGitHubHttpClient;
  let oauthService: GitHubOAuthService;
  let sessionService: SessionService;
  let userRepository: UserRepository;
  let accountRepository: AccountRepository;
  let membershipRepository: MembershipRepository;

  beforeEach(async () => {
    // Setup MongoDB
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");

    // Setup services
    fakeGitHubClient = new FakeGitHubHttpClient();
    oauthService = new GitHubOAuthService(fakeGitHubClient, {
      clientId: "test-client-id",
      redirectUri: "http://localhost:3000/auth/github/callback",
    });
    sessionService = new SessionService("test-secret");
    userRepository = new UserRepository(db);
    accountRepository = new AccountRepository(db);
    membershipRepository = new MembershipRepository(db);

    // Setup Fastify
    app = Fastify();
    await app.register(cookie, { secret: "cookie-secret" });

    // Register routes
    registerGitHubAuthRoutes(app, {
      oauthService,
      sessionService,
      userRepository,
      accountRepository,
      membershipRepository,
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await client.close();
    await mongoServer.stop();
  });

  describe("GET /auth/github", () => {
    it("should redirect to GitHub OAuth URL", async () => {
      // When: I visit the GitHub auth endpoint
      const response = await app.inject({
        method: "GET",
        url: "/auth/github",
      });

      // Then: I'm redirected to GitHub OAuth
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain(
        "https://github.com/login/oauth/authorize",
      );
      expect(response.headers.location).toContain("client_id=test-client-id");
    });

    it("should include state parameter for CSRF protection", async () => {
      // When: I visit the GitHub auth endpoint
      const response = await app.inject({
        method: "GET",
        url: "/auth/github",
      });

      // Then: the redirect URL includes a state parameter
      expect(response.headers.location).toContain("state=");
    });
  });

  describe("GET /auth/github/callback", () => {
    it("should create user and session on successful OAuth", async () => {
      // Given: GitHub will authenticate successfully
      fakeGitHubClient.setTokenResponse("valid-code", {
        access_token: "gho_abc123",
        token_type: "bearer",
        scope: "user:email",
      });
      fakeGitHubClient.setUserResponse("gho_abc123", {
        id: 12345,
        login: "octocat",
        email: "octocat@github.com",
        name: "The Octocat",
        avatar_url: "https://github.com/images/octocat.png",
      });

      // When: I complete the OAuth callback
      const response = await app.inject({
        method: "GET",
        url: "/auth/github/callback?code=valid-code&state=test-state",
      });

      // Then: I'm redirected to the dashboard
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");

      // And: a session cookie is set
      const cookies = response.cookies;
      const sessionCookie = cookies.find((c) => c.name === "session");
      expect(sessionCookie).toBeDefined();
    });

    it("should create user record in database", async () => {
      // Given: GitHub will authenticate successfully
      fakeGitHubClient.setTokenResponse("valid-code", {
        access_token: "gho_abc123",
        token_type: "bearer",
        scope: "user:email",
      });
      fakeGitHubClient.setUserResponse("gho_abc123", {
        id: 12345,
        login: "octocat",
        email: "octocat@github.com",
        name: "The Octocat",
        avatar_url: "https://github.com/images/octocat.png",
      });

      // When: I complete the OAuth callback
      await app.inject({
        method: "GET",
        url: "/auth/github/callback?code=valid-code&state=test-state",
      });

      // Then: user is persisted in database
      const user = await userRepository.findByGitHubId(12345);
      expect(user).not.toBeNull();
      expect(user?.githubLogin).toBe("octocat");
      expect(user?.email).toBe("octocat@github.com");
    });

    it("should return existing user on repeat login", async () => {
      // Given: User already exists
      fakeGitHubClient.setTokenResponse("valid-code", {
        access_token: "gho_abc123",
        token_type: "bearer",
        scope: "user:email",
      });
      fakeGitHubClient.setUserResponse("gho_abc123", {
        id: 12345,
        login: "octocat",
        email: "octocat@github.com",
        name: "The Octocat",
        avatar_url: "https://github.com/images/octocat.png",
      });

      // First login
      await app.inject({
        method: "GET",
        url: "/auth/github/callback?code=valid-code&state=test-state",
      });

      // When: Same user logs in again
      fakeGitHubClient.setTokenResponse("another-code", {
        access_token: "gho_def456",
        token_type: "bearer",
        scope: "user:email",
      });
      fakeGitHubClient.setUserResponse("gho_def456", {
        id: 12345, // Same GitHub ID
        login: "octocat",
        email: "octocat@github.com",
        name: "The Octocat",
        avatar_url: "https://github.com/images/octocat.png",
      });

      await app.inject({
        method: "GET",
        url: "/auth/github/callback?code=another-code&state=test-state",
      });

      // Then: still only one user in database
      const users = await db.collection("users").find({}).toArray();
      expect(users.length).toBe(1);
    });

    it("should redirect to home on invalid code", async () => {
      // When: I complete callback with invalid code
      const response = await app.inject({
        method: "GET",
        url: "/auth/github/callback?code=invalid-code&state=test-state",
      });

      // Then: I'm redirected to home with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/?error=auth_failed");
    });
  });
});
