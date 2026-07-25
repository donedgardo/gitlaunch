import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { registerGoogleAuthRoutes } from "./google";
import {
  GoogleOAuthService,
  IGoogleHttpClient,
  GoogleTokenResponse,
  GoogleUserResponse,
} from "../../../services/auth/googleOAuthService";
import { SessionService } from "../../../services/auth/sessionService";
import { UserRepository } from "../../../repositories/userRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../../repositories/membershipRepository";
import { SignupGate } from "../../../services/account/signupGate";
import { FlagServiceI } from "../../../services/flag/flagService";
import { FlagEvaluation } from "../../../services/flag/flagEvaluator";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";

// A real SignupGate wired to a stubbed flag engine: the gate's own behaviour is
// covered in signupGate.test.ts; here we only need it to answer on/off. Mirrors
// the helper in github.test.ts so every front door is tested the same way.
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

class FakeGoogleHttpClient implements IGoogleHttpClient {
  private tokenResponses = new Map<string, GoogleTokenResponse>();
  private userResponses = new Map<string, GoogleUserResponse>();

  setTokenResponse(code: string, response: GoogleTokenResponse) {
    this.tokenResponses.set(code, response);
  }
  setUserResponse(token: string, response: GoogleUserResponse) {
    this.userResponses.set(token, response);
  }
  async exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
    const r = this.tokenResponses.get(code);
    if (!r) throw new Error("Invalid authorization code");
    return r;
  }
  async getUserInfo(accessToken: string): Promise<GoogleUserResponse> {
    const r = this.userResponses.get(accessToken);
    if (!r) throw new Error("Invalid access token");
    return r;
  }
}

describe("Google OAuth Routes", () => {
  let app: FastifyInstance;
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let fakeGoogleClient: FakeGoogleHttpClient;
  let oauthService: GoogleOAuthService;
  let userRepository: UserRepository;
  let accountRepository: AccountRepository;
  let membershipRepository: MembershipRepository;

  beforeEach(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");

    fakeGoogleClient = new FakeGoogleHttpClient();
    oauthService = new GoogleOAuthService(fakeGoogleClient, {
      clientId: "test-client-id",
      redirectUri: "http://localhost:3000/auth/google/callback",
    });
    userRepository = new UserRepository(db);
    accountRepository = new AccountRepository(db);
    membershipRepository = new MembershipRepository(db);

    app = Fastify();
    await app.register(cookie, { secret: "cookie-secret" });
    registerGoogleAuthRoutes(app, {
      oauthService,
      sessionService: new SessionService("test-secret"),
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

  describe("GET /auth/google", () => {
    it("should redirect to Google's consent screen", async () => {
      const response = await app.inject({ method: "GET", url: "/auth/google" });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      expect(response.headers.location).toContain("state=");
    });
  });

  describe("GET /auth/google/callback", () => {
    it("should create a user + session and send a new user to onboarding", async () => {
      fakeGoogleClient.setTokenResponse("valid-code", {
        access_token: "ya29.token",
        token_type: "bearer",
        scope: "openid email profile",
      });
      fakeGoogleClient.setUserResponse("ya29.token", {
        sub: "google-sub-42",
        email: "gopher@gmail.com",
        email_verified: true,
        name: "Go Gopher",
        picture: null,
      });

      const response = await app.inject({
        method: "GET",
        url: "/auth/google/callback?code=valid-code&state=s",
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding/plan-selection");
      expect(response.cookies.find((c) => c.name === "session")).toBeDefined();

      const user = await userRepository.findByGoogleId("google-sub-42");
      expect(user).not.toBeNull();
      expect(user!.email).toBe("gopher@gmail.com");
    });

    it("should send a returning user to the dashboard without duplicating them", async () => {
      fakeGoogleClient.setTokenResponse("code-1", {
        access_token: "tok-1",
        token_type: "bearer",
        scope: "openid email profile",
      });
      fakeGoogleClient.setUserResponse("tok-1", {
        sub: "google-sub-7",
        email: "repeat@gmail.com",
        name: "Repeat",
        picture: null,
      });

      await app.inject({
        method: "GET",
        url: "/auth/google/callback?code=code-1&state=s",
      });
      const second = await app.inject({
        method: "GET",
        url: "/auth/google/callback?code=code-1&state=s",
      });

      expect(second.headers.location).toBe("/dashboard");
      const users = await db.collection("users").find({}).toArray();
      expect(users.length).toBe(1);
    });

    it("should redirect home on an invalid code", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/google/callback?code=nope&state=s",
      });
      expect(response.headers.location).toBe("/?error=auth_failed");
    });
  });

  // GitLaunch gates its own front door with its own feature-flag engine. The
  // Google door must honour the same kill switch as GitHub OAuth: a brand-new
  // signup is refused when self-serve-signups is off, but existing customers
  // can still sign in.
  describe("signup gate", () => {
    const gatedApps: FastifyInstance[] = [];

    async function appWithGate(gate: SignupGate): Promise<FastifyInstance> {
      const gated = Fastify();
      await gated.register(cookie, { secret: "cookie-secret" });
      registerGoogleAuthRoutes(gated, {
        oauthService,
        sessionService: new SessionService("test-secret"),
        userRepository,
        accountRepository,
        membershipRepository,
        signupGate: gate,
      });
      await gated.ready();
      gatedApps.push(gated);
      return gated;
    }

    function googleWillReturn(sub: string, email: string) {
      fakeGoogleClient.setTokenResponse("valid-code", {
        access_token: "ya29.token",
        token_type: "bearer",
        scope: "openid email profile",
      });
      fakeGoogleClient.setUserResponse("ya29.token", {
        sub,
        email,
        email_verified: true,
        name: "Newcomer",
        picture: null,
      });
    }

    afterEach(async () => {
      await Promise.all(gatedApps.splice(0).map((a) => a.close()));
    });

    it("should refuse to create an account when signups are closed", async () => {
      // Given: signups are flagged off, and a brand-new visitor signs in
      const gated = await appWithGate(gateThatSays(false));
      googleWillReturn("google-sub-99", "newcomer@gmail.com");

      // When: they complete the OAuth callback
      const response = await gated.inject({
        method: "GET",
        url: "/auth/google/callback?code=valid-code&state=s",
      });

      // Then: they're sent back to the landing page, told signups are closed
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/?error=signups_closed");

      // And: nothing was created for them — no user, account, or membership
      expect(await userRepository.findByGoogleId("google-sub-99")).toBeNull();
      const accounts = await db.collection("accounts").find({}).toArray();
      expect(accounts).toEqual([]);

      // And: they are not signed in
      expect(
        response.cookies.find((c) => c.name === "session"),
      ).toBeUndefined();
    });

    it("should create the account as usual when signups are open", async () => {
      // Given: signups are flagged on
      const gated = await appWithGate(gateThatSays(true));
      googleWillReturn("google-sub-99", "newcomer@gmail.com");

      // When: a brand-new visitor completes the OAuth callback
      const response = await gated.inject({
        method: "GET",
        url: "/auth/google/callback?code=valid-code&state=s",
      });

      // Then: onboarding starts and they have an account
      expect(response.headers.location).toBe("/onboarding/plan-selection");
      const accounts = await db.collection("accounts").find({}).toArray();
      expect(accounts.length).toBe(1);
    });

    it("should still sign in an existing customer when signups are closed", async () => {
      // Given: someone who already has a Google account + membership
      const user = await userRepository.findOrCreateByGoogleId({
        googleId: "google-sub-7",
        email: "returning@gmail.com",
        name: "Returning",
        avatarUrl: null,
      });
      const account = await accountRepository.create({
        name: "Returning's Account",
        slug: "returning-google",
      });
      await membershipRepository.create({
        userId: user._id,
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      // And: signups have since been closed
      const gated = await appWithGate(gateThatSays(false));
      googleWillReturn("google-sub-7", "returning@gmail.com");

      // When: they complete the OAuth callback
      const response = await gated.inject({
        method: "GET",
        url: "/auth/google/callback?code=valid-code&state=s",
      });

      // Then: the gate never touches them — they reach their dashboard
      expect(response.headers.location).toBe("/dashboard");
    });
  });
});
