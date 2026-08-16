import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { registerGitHubAuthRoutes } from "./github";
import {
  GitHubOAuthService,
  IGitHubHttpClient,
  GitHubTokenResponse,
  GitHubUserResponse,
} from "../../../services/auth/githubOAuthService";
import { SessionService } from "../../../services/auth/sessionService";
import { UserRepository } from "../../../repositories/userRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../../repositories/membershipRepository";
import { InvitationRepository } from "../../../../ee/repositories/invitationRepository";
import { PendingInviteRedeemer } from "../../../services/auth/pendingInvite";
import { acceptInvitation } from "../../../../ee/server/routes/invite/acceptInvitation";
import { SignupGate } from "../../../services/account/signupGate";
import { FlagServiceI } from "../../../services/flag/flagService";
import { FlagEvaluation } from "../../../services/flag/flagEvaluator";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";

// Fake GitHub HTTP client for testing
class FakeGitHubHttpClient implements IGitHubHttpClient {
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

// A real SignupGate wired to a stubbed flag engine: the gate's own behaviour is
// covered in signupGate.test.ts, here we only need it to answer on/off.
const SELF_SERVICE_ID = new ObjectId();
const SELF_ACCOUNT_ID = new ObjectId();

function gateThatSays(enabled: boolean): SignupGate {
  const flags: Partial<FlagServiceI> = {
    async evaluateOne(): Promise<FlagEvaluation | null> {
      return {
        key: "self-serve-signups",
        enabled,
        variant: null,
        reason: enabled ? "rollout" : "disabled",
      };
    },
  };
  const services = {
    async findById() {
      return { _id: SELF_SERVICE_ID, accountId: SELF_ACCOUNT_ID };
    },
  };
  const analytics: AnalyticsService = {
    identify() {},
    track() {},
    navigation() {},
  };
  return new SignupGate(
    flags as FlagServiceI,
    services as unknown as ServiceRepository,
    analytics,
    { serviceId: SELF_SERVICE_ID, environment: "prod" },
  );
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
      cookieSecure: false,
      useFakeGitHub: false,
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

    it("short-circuits to the local callback in fake mode (no real GitHub)", async () => {
      const fake = Fastify();
      await fake.register(cookie, { secret: "cookie-secret" });
      registerGitHubAuthRoutes(fake, {
        cookieSecure: false,
        useFakeGitHub: true,
        oauthService,
        sessionService,
        userRepository,
        accountRepository,
        membershipRepository,
      });
      await fake.ready();

      const response = await fake.inject({
        method: "GET",
        url: "/auth/github",
      });

      // Then: it stays local — a relative callback path, not github.com
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).not.toContain("github.com");
      expect(response.headers.location).toMatch(
        /^\/auth\/github\/callback\?code=[^&]+&state=[^&]+$/,
      );

      await fake.close();
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

      // Then: I'm redirected to plan selection (new user)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding/plan-selection");

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

  // GitLaunch gates its own front door with its own feature-flag engine: the
  // flag decides whether a brand-new visitor may create an account.
  describe("signup gate", () => {
    const gatedApps: FastifyInstance[] = [];

    async function appWithGate(
      gate: SignupGate,
      extra: { redeemPendingInvite?: PendingInviteRedeemer } = {},
    ): Promise<FastifyInstance> {
      const gated = Fastify();
      await gated.register(cookie, { secret: "cookie-secret" });
      registerGitHubAuthRoutes(gated, {
        cookieSecure: false,
        useFakeGitHub: false,
        oauthService,
        sessionService,
        userRepository,
        accountRepository,
        membershipRepository,
        signupGate: gate,
        ...extra,
      });
      await gated.ready();
      gatedApps.push(gated);
      return gated;
    }

    function githubWillReturn(login: string, id: number) {
      fakeGitHubClient.setTokenResponse("valid-code", {
        access_token: "gho_abc123",
        token_type: "bearer",
        scope: "user:email",
      });
      fakeGitHubClient.setUserResponse("gho_abc123", {
        id,
        login,
        email: `${login}@github.com`,
        name: login,
        avatar_url: "https://github.com/images/octocat.png",
      });
    }

    afterEach(async () => {
      await Promise.all(gatedApps.splice(0).map((a) => a.close()));
    });

    it("should refuse to create an account when signups are closed", async () => {
      // Given: signups are flagged off, and a brand-new visitor signs in
      const gated = await appWithGate(gateThatSays(false));
      githubWillReturn("newcomer", 999);

      // When: they complete the OAuth callback
      const response = await gated.inject({
        method: "GET",
        url: "/auth/github/callback?code=valid-code&state=test-state",
      });

      // Then: they're sent back to the landing page, told signups are closed
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/?error=signups_closed");

      // And: nothing was created for them — no account, no membership, no user
      const accounts = await db.collection("accounts").find({}).toArray();
      expect(accounts).toEqual([]);
      const memberships = await db.collection("memberships").find({}).toArray();
      expect(memberships).toEqual([]);
      expect(await userRepository.findByGitHubId(999)).toBeNull();

      // And: they are not signed in
      expect(
        response.cookies.find((c) => c.name === "session"),
      ).toBeUndefined();
    });

    it("should create the account as usual when signups are open", async () => {
      // Given: signups are flagged on
      const gated = await appWithGate(gateThatSays(true));
      githubWillReturn("newcomer", 999);

      // When: a brand-new visitor completes the OAuth callback
      const response = await gated.inject({
        method: "GET",
        url: "/auth/github/callback?code=valid-code&state=test-state",
      });

      // Then: onboarding starts and they have an account
      expect(response.headers.location).toBe("/onboarding/plan-selection");
      const accounts = await db.collection("accounts").find({}).toArray();
      expect(accounts.length).toBe(1);
    });

    it("should still sign in an existing customer when signups are closed", async () => {
      // Given: someone who already has an account
      const user = await userRepository.create({
        githubId: 999,
        githubLogin: "returning",
        email: "returning@github.com",
        name: "Returning",
        avatarUrl: null,
      });
      const account = await accountRepository.create({
        name: "Returning's Account",
        slug: "returning",
      });
      await membershipRepository.create({
        userId: user._id,
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      // And: signups have since been closed
      const gated = await appWithGate(gateThatSays(false));
      githubWillReturn("returning", 999);

      // When: they sign in
      const response = await gated.inject({
        method: "GET",
        url: "/auth/github/callback?code=valid-code&state=test-state",
      });

      // Then: the kill switch doesn't touch them — straight to the dashboard
      expect(response.headers.location).toBe("/dashboard");
      expect(response.cookies.find((c) => c.name === "session")).toBeDefined();
    });

    it("should still let an invited teammate join when signups are closed", async () => {
      // Given: an existing workspace with a pending invite
      const invitationRepository = new InvitationRepository(db);
      const owner = await userRepository.create({
        githubId: 1,
        githubLogin: "owner",
        email: "owner@github.com",
        name: "Owner",
        avatarUrl: null,
      });
      const account = await accountRepository.create({
        name: "Team",
        slug: "team",
      });
      await invitationRepository.create({
        accountId: account._id,
        invitedByUserId: owner._id,
        email: "invitee@github.com",
        role: MembershipRole.Member,
        token: "invite-token",
        expiresAt: new Date(Date.now() + 60_000),
      });

      // And: signups are closed to the public
      const gated = await appWithGate(gateThatSays(false), {
        redeemPendingInvite: async (token, userId) => {
          const accepted = await acceptInvitation(
            invitationRepository,
            membershipRepository,
            token,
            userId,
          );
          return accepted.ok
            ? { joined: true, accountId: accepted.accountId }
            : { joined: false };
        },
      });
      githubWillReturn("invitee", 999);

      // When: the invitee signs in carrying their invite
      const response = await gated.inject({
        method: "GET",
        url: "/auth/github/callback?code=valid-code&state=test-state",
        cookies: { pending_invite: "invite-token" },
      });

      // Then: they land in the workspace they were invited to
      expect(response.headers.location).toBe("/dashboard");
      const memberships = await membershipRepository.findByUserId(
        (await userRepository.findByGitHubId(999))!._id,
      );
      expect(
        memberships.some(
          (m) => m.accountId.toString() === account._id.toString(),
        ),
      ).toBe(true);
    });

    it("should allow signups when no gate is configured", async () => {
      // Given: no signup gate is wired up at all (default deployment)
      githubWillReturn("newcomer", 999);

      // When: a brand-new visitor completes the OAuth callback on the
      // ungated app registered by the outer suite
      const response = await app.inject({
        method: "GET",
        url: "/auth/github/callback?code=valid-code&state=test-state",
      });

      // Then: signup proceeds
      expect(response.headers.location).toBe("/onboarding/plan-selection");
    });
  });
});
