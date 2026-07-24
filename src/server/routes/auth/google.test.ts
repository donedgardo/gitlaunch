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
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";

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
});
