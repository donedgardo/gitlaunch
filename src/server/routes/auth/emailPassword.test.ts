import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import fastifyView from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { registerEmailPasswordAuthRoutes } from "./emailPassword";
import { registerHandlebarsHelpers } from "../../registerHandlebarsHelpers";
import { SessionService } from "../../../services/auth/sessionService";
import { PasswordService } from "../../../services/auth/passwordService";
import { ConsoleEmailSender } from "../../../services/email/emailSender";
import { UserRepository } from "../../../repositories/userRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { SignupGate } from "../../../services/account/signupGate";
import { FlagServiceI } from "../../../services/flag/flagService";
import { FlagEvaluation } from "../../../services/flag/flagEvaluator";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";

// A real SignupGate wired to a stubbed flag engine: the gate's own behaviour is
// covered in signupGate.test.ts, here we only need it to answer on/off. Mirrors
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

describe("Email/Password Auth Routes", () => {
  let app: FastifyInstance;
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let userRepository: UserRepository;
  let emailSender: ConsoleEmailSender;

  beforeEach(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    userRepository = new UserRepository(db);
    emailSender = new ConsoleEmailSender();

    registerHandlebarsHelpers();
    app = Fastify();
    await app.register(cookie, { secret: "cookie-secret" });
    await app.register(formbody);
    await app.register(fastifyView, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: { compileOptions: { preventIndent: true } },
    });

    registerEmailPasswordAuthRoutes(app, {
      sessionService: new SessionService("test-secret"),
      userRepository,
      accountRepository: new AccountRepository(db),
      membershipRepository: new MembershipRepository(db),
      passwordService: new PasswordService(4),
      emailSender,
      publicUrl: "http://localhost:3050",
      googleEnabled: true,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await client.close();
    await mongoServer.stop();
  });

  async function signup(body: Record<string, string>) {
    return app.inject({ method: "POST", url: "/auth/signup", payload: body });
  }

  describe("POST /auth/signup", () => {
    it("should create an unverified user, email a link, and NOT log them in", async () => {
      const response = await signup({
        name: "New Person",
        email: "new@example.com",
        password: "longenough1",
      });

      // Then: they land on the "check your email" page, with no session yet
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Check your email");
      expect(
        response.cookies.find((c) => c.name === "session"),
      ).toBeUndefined();

      // And: the user exists but is unverified
      const user = await userRepository.findByEmail("new@example.com");
      expect(user).not.toBeNull();
      expect(user!.emailVerified).toBe(false);

      // And: a confirmation email was sent containing the verify link
      expect(emailSender.sent).toHaveLength(1);
      expect(emailSender.sent[0].to).toBe("new@example.com");
      expect(emailSender.sent[0].text).toContain("/auth/verify-email?token=");
    });

    it("should reject a weak password", async () => {
      const response = await signup({
        email: "weak@example.com",
        password: "short",
      });
      expect(response.headers.location).toBe("/signup?error=weak_password");
      expect(await userRepository.findByEmail("weak@example.com")).toBeNull();
    });

    it("should reject signing up an email that already exists", async () => {
      await signup({ email: "dupe@example.com", password: "longenough1" });
      const response = await signup({
        email: "dupe@example.com",
        password: "longenough2",
      });
      expect(response.headers.location).toBe("/signup?error=email_taken");
    });
  });

  describe("email confirmation gate", () => {
    it("should block login until the email is confirmed", async () => {
      await signup({ email: "gate@example.com", password: "longenough1" });

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "gate@example.com", password: "longenough1" },
      });

      expect(response.headers.location).toBe("/login?error=unverified");
      expect(
        response.cookies.find((c) => c.name === "session"),
      ).toBeUndefined();
    });

    it("should confirm the email via the token and log the user in", async () => {
      await signup({ email: "confirm@example.com", password: "longenough1" });
      const before = await userRepository.findByEmail("confirm@example.com");
      const token = before!.emailVerificationToken!;

      const response = await app.inject({
        method: "GET",
        url: `/auth/verify-email?token=${token}`,
      });

      // Then: verified, session set, sent to onboarding
      expect(response.headers.location).toBe("/onboarding/plan-selection");
      expect(response.cookies.find((c) => c.name === "session")).toBeDefined();
      const after = await userRepository.findByEmail("confirm@example.com");
      expect(after!.emailVerified).toBe(true);
    });

    it("should reject an unknown confirmation token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/verify-email?token=not-a-real-token",
      });
      expect(response.headers.location).toBe("/login?error=invalid_token");
    });
  });

  describe("POST /auth/login", () => {
    it("should log in a confirmed user and set a session", async () => {
      await signup({ email: "member@example.com", password: "longenough1" });
      const user = await userRepository.findByEmail("member@example.com");
      await userRepository.markEmailVerified(user!._id);

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "member@example.com", password: "longenough1" },
      });

      expect(response.headers.location).toBe("/dashboard");
      expect(response.cookies.find((c) => c.name === "session")).toBeDefined();
    });

    it("should reject a wrong password with a generic error", async () => {
      await signup({ email: "wrong@example.com", password: "longenough1" });
      const user = await userRepository.findByEmail("wrong@example.com");
      await userRepository.markEmailVerified(user!._id);

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "wrong@example.com", password: "totally-wrong" },
      });

      expect(response.headers.location).toBe(
        "/login?error=invalid_credentials",
      );
    });

    it("should not reveal whether an unknown email exists", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "ghost@example.com", password: "whatever12" },
      });
      expect(response.headers.location).toBe(
        "/login?error=invalid_credentials",
      );
    });
  });

  describe("POST /auth/resend-verification", () => {
    it("should send a fresh link for an unverified account", async () => {
      await signup({ email: "resend@example.com", password: "longenough1" });
      expect(emailSender.sent).toHaveLength(1);

      const response = await app.inject({
        method: "POST",
        url: "/auth/resend-verification",
        payload: { email: "resend@example.com" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Check your email");
      expect(emailSender.sent).toHaveLength(2);
    });
  });

  describe("GET /login and /signup pages", () => {
    it("should render the login page with the email form", async () => {
      const response = await app.inject({ method: "GET", url: "/login" });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('action="/auth/login"');
      expect(response.body).toContain("Continue with GitHub");
    });

    it("should render the signup page with the email form", async () => {
      const response = await app.inject({ method: "GET", url: "/signup" });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('action="/auth/signup"');
    });
  });

  // GitLaunch gates its own front door with its own feature-flag engine. The
  // email/password door must honour the same kill switch as GitHub OAuth: a
  // brand-new signup is refused when self-serve-signups is off, but existing
  // customers can still log in.
  describe("signup gate", () => {
    const gatedApps: FastifyInstance[] = [];

    async function appWithGate(gate: SignupGate): Promise<{
      gated: FastifyInstance;
      sender: ConsoleEmailSender;
    }> {
      const sender = new ConsoleEmailSender();
      const gated = Fastify();
      await gated.register(cookie, { secret: "cookie-secret" });
      await gated.register(formbody);
      await gated.register(fastifyView, {
        engine: { handlebars },
        root: path.join(__dirname, "../../../templates"),
        options: { compileOptions: { preventIndent: true } },
      });
      registerEmailPasswordAuthRoutes(gated, {
        sessionService: new SessionService("test-secret"),
        userRepository,
        accountRepository: new AccountRepository(db),
        membershipRepository: new MembershipRepository(db),
        passwordService: new PasswordService(4),
        emailSender: sender,
        publicUrl: "http://localhost:3050",
        googleEnabled: true,
        signupGate: gate,
      });
      await gated.ready();
      gatedApps.push(gated);
      return { gated, sender };
    }

    afterEach(async () => {
      await Promise.all(gatedApps.splice(0).map((a) => a.close()));
    });

    it("should refuse a brand-new signup when signups are closed", async () => {
      // Given: signups are flagged off
      const { gated, sender } = await appWithGate(gateThatSays(false));

      // When: a stranger tries to sign up
      const response = await gated.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          name: "Stranger",
          email: "stranger@example.com",
          password: "longenough1",
        },
      });

      // Then: they're sent back to the landing page, told signups are closed
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/?error=signups_closed");

      // And: nothing was created and no confirmation email went out — the check
      // runs before any write, so a refused signup leaves no orphan user.
      expect(
        await userRepository.findByEmail("stranger@example.com"),
      ).toBeNull();
      expect(sender.sent).toHaveLength(0);
    });

    it("should create the signup as usual when signups are open", async () => {
      // Given: signups are flagged on
      const { gated, sender } = await appWithGate(gateThatSays(true));

      // When: a new person signs up
      const response = await gated.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          name: "Newcomer",
          email: "newcomer@example.com",
          password: "longenough1",
        },
      });

      // Then: the usual check-your-email flow runs, unverified user created
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Check your email");
      const user = await userRepository.findByEmail("newcomer@example.com");
      expect(user).not.toBeNull();
      expect(user!.emailVerified).toBe(false);
      expect(sender.sent).toHaveLength(1);
    });

    it("should still log in an existing verified customer when signups are closed", async () => {
      // Given: a verified password customer already exists
      const seed = await appWithGate(gateThatSays(true));
      await seed.gated.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          name: "Returning",
          email: "returning@example.com",
          password: "longenough1",
        },
      });
      const user = await userRepository.findByEmail("returning@example.com");
      await userRepository.markEmailVerified(user!._id);

      // And: signups have since been closed
      const { gated } = await appWithGate(gateThatSays(false));

      // When: they log in (not a new account — an existing customer)
      const response = await gated.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "returning@example.com", password: "longenough1" },
      });

      // Then: the gate never touches them — they reach their dashboard
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");
    });
  });
});
