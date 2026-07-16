import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import {
  AccountRepository,
  Plan,
} from "../../../repositories/accountRepository";
import { UserRepository } from "../../../repositories/userRepository";
import {
  StripeService,
  StripeClient,
} from "../../../services/billing/stripeService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerBillingRoutes } from "./billing";

// Fake Stripe client
class FakeStripeClient implements StripeClient {
  checkoutUrl = "https://checkout.stripe.com/test";
  portalUrl = "https://billing.stripe.com/test";

  async createCheckoutSession() {
    return { url: this.checkoutUrl, id: "cs_test" };
  }
  async createCustomer() {
    return { id: "cus_test" };
  }
  async createBillingPortalSession() {
    return { url: this.portalUrl };
  }
  async getSubscription(id: string) {
    return { id, status: "active", currentPeriodEnd: new Date() };
  }
}

describe("Billing Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let userRepo: UserRepository;
  let stripeService: StripeService;
  let planService: PlanEnforcementService;
  let sessionService: SessionService;

  const TEST_SECRET = "test-secret-for-billing";

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    userRepo = new UserRepository(db);
    const repoRepo = new RepositoryRepository(db);
    const serviceRepo = new ServiceRepository(db);
    const membershipRepo = new MembershipRepository(db);
    stripeService = new StripeService(new FakeStripeClient(), {
      proPriceId: "price_pro",
      teamPriceId: "price_team",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });
    planService = new PlanEnforcementService(
      accountRepo,
      repoRepo,
      serviceRepo,
      membershipRepo,
    );
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("users").deleteMany({});

    sessionService = new SessionService(TEST_SECRET);
    app = Fastify();
    await app.register(cookie);
    await app.register(formbody);
    await app.register(view, {
      engine: {
        handlebars,
      },
      root: path.join(__dirname, "../../../templates"),
      options: {
        partials: {
          navigation: "/partials/navigation.hbs",
        },
      },
    });
    sessionAuthMiddleware(app, sessionService);
    registerBillingRoutes(app, {
      stripeService,
      planEnforcementService: planService,
      accountRepo,
      userRepo,
      serviceRepo: new ServiceRepository(db),
    });
    await app.ready();
  });

  describe("POST /api/billing/checkout", () => {
    it("should return checkout URL for authenticated user with plan parameter", async () => {
      // Given: an account and authenticated user
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      const user = await userRepo.create({
        email: "user@example.com",
        name: "Test User",
        githubId: 12345,
        githubLogin: "testuser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I request checkout with plan
      const response = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        cookies: {
          session: sessionToken,
        },
        payload: {
          plan: "pro",
        },
      });

      // Then: I get checkout URL
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.checkoutUrl).toBe("https://checkout.stripe.com/test");
    });

    it("should return 401 without authentication", async () => {
      // When: requesting checkout without auth
      const response = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
      });

      // Then: unauthorized
      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /api/billing/portal", () => {
    it("should return portal URL for paid account", async () => {
      // Given: a paid account and authenticated user
      const account = await accountRepo.create({
        name: "Paid Org",
        slug: "paid-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_test",
        "sub_test",
        Plan.Pro,
      );
      const user = await userRepo.create({
        email: "paid@example.com",
        name: "Paid User",
        githubId: 12346,
        githubLogin: "paiduser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I request billing portal
      const response = await app.inject({
        method: "POST",
        url: "/api/billing/portal",
        cookies: {
          session: sessionToken,
        },
        payload: {
          returnUrl: "https://app.example.com/settings",
        },
      });

      // Then: I get portal URL
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.portalUrl).toBe("https://billing.stripe.com/test");
    });

    it("should return 400 for free account without Stripe customer", async () => {
      // Given: a free account (no Stripe customer) and authenticated user
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org",
      });
      const user = await userRepo.create({
        email: "free@example.com",
        name: "Free User",
        githubId: 12347,
        githubLogin: "freeuser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I request billing portal
      const response = await app.inject({
        method: "POST",
        url: "/api/billing/portal",
        cookies: {
          session: sessionToken,
        },
        payload: {
          returnUrl: "https://app.example.com/settings",
        },
      });

      // Then: error returned
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/billing/usage", () => {
    it("should return current usage and limits", async () => {
      // Given: an account and authenticated user
      const account = await accountRepo.create({
        name: "Usage Org",
        slug: "usage-org",
      });
      const user = await userRepo.create({
        email: "usage@example.com",
        name: "Usage User",
        githubId: 12348,
        githubLogin: "usageuser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I get usage
      const response = await app.inject({
        method: "GET",
        url: "/api/billing/usage",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: I see usage info
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.repositories).toBeDefined();
      expect(body.users).toBeDefined();
      expect(body.plan).toBe(Plan.Free);
    });
  });

  describe("GET /settings/billing", () => {
    it("should return 200 with rendered page for authenticated user", async () => {
      // Given: an account and authenticated user
      const account = await accountRepo.create({
        name: "Billing Org",
        slug: "billing-org",
      });
      const user = await userRepo.create({
        email: "billing@example.com",
        name: "Billing User",
        githubId: 12349,
        githubLogin: "billinguser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I visit billing settings page
      const response = await app.inject({
        method: "GET",
        url: "/settings/billing",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: I see the page
      if (response.statusCode !== 200) {
        console.log("Error response:", response.payload);
      }
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.payload).toContain("Billing");
    });

    it("should return 401 without authentication", async () => {
      // When: visiting billing page without auth
      const response = await app.inject({
        method: "GET",
        url: "/settings/billing",
      });

      // Then: unauthorized
      expect(response.statusCode).toBe(401);
    });

    it("should offer an upgrade checkout option for a Free account that still has a Stripe customer", async () => {
      // Given: an account that upgraded then downgraded back to Free.
      // downgradeToFree keeps stripeCustomerId, so the account is on the Free
      // plan but still has a Stripe customer record.
      const account = await accountRepo.create({
        name: "Lapsed Org",
        slug: "lapsed-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_lapsed",
        "sub_lapsed",
        Plan.Pro,
      );
      await accountRepo.downgradeToFree(account._id);
      const user = await userRepo.create({
        email: "lapsed@example.com",
        name: "Lapsed User",
        githubId: 22345,
        githubLogin: "lapseduser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I visit the billing page
      const response = await app.inject({
        method: "GET",
        url: "/settings/billing",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: I am offered a way to upgrade (a checkout action), not only the
      // billing portal.
      expect(response.statusCode).toBe(200);
      expect(response.payload).toContain('action="/api/billing/checkout"');
    });
  });

  describe("POST /api/billing/checkout with plan parameter", () => {
    it("should accept plan=pro and return HX-Redirect header for HTMX requests", async () => {
      // Given: an account and authenticated user
      const account = await accountRepo.create({
        name: "Pro Org",
        slug: "pro-org",
      });
      const user = await userRepo.create({
        email: "pro@example.com",
        name: "Pro User",
        githubId: 12350,
        githubLogin: "prouser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I request checkout for Pro plan with HTMX
      const response = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "hx-request": "true",
        },
        payload: {
          plan: "pro",
        },
      });

      // Then: I get HX-Redirect header
      expect(response.statusCode).toBe(200);
      expect(response.headers["hx-redirect"]).toBe(
        "https://checkout.stripe.com/test",
      );
    });

    it("should return 400 when plan is free", async () => {
      // Given: an account and authenticated user
      const account = await accountRepo.create({
        name: "Free Plan Org",
        slug: "free-plan-org",
      });
      const user = await userRepo.create({
        email: "freeplan@example.com",
        name: "Free Plan User",
        githubId: 12351,
        githubLogin: "freeplanuser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I try to checkout with free plan
      const response = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        cookies: {
          session: sessionToken,
        },
        payload: {
          plan: "free",
        },
      });

      // Then: error returned
      expect(response.statusCode).toBe(400);
    });

    it("should return 400 when plan is invalid", async () => {
      // Given: an account and authenticated user
      const account = await accountRepo.create({
        name: "Invalid Plan Org",
        slug: "invalid-plan-org",
      });
      const user = await userRepo.create({
        email: "invalid@example.com",
        name: "Invalid User",
        githubId: 12352,
        githubLogin: "invaliduser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I try to checkout with invalid plan
      const response = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        cookies: {
          session: sessionToken,
        },
        payload: {
          plan: "enterprise",
        },
      });

      // Then: error returned
      expect(response.statusCode).toBe(400);
    });

    it("should return JSON checkoutUrl for non-HTMX requests", async () => {
      // Given: an account and authenticated user
      const account = await accountRepo.create({
        name: "JSON Org",
        slug: "json-org",
      });
      const user = await userRepo.create({
        email: "json@example.com",
        name: "JSON User",
        githubId: 12353,
        githubLogin: "jsonuser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I request checkout without HTMX header
      const response = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        cookies: {
          session: sessionToken,
        },
        payload: {
          plan: "pro",
        },
      });

      // Then: I get JSON response
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.checkoutUrl).toBe("https://checkout.stripe.com/test");
    });
  });

  describe("POST /api/billing/portal with HX-Redirect", () => {
    it("should return HX-Redirect header for HTMX requests", async () => {
      // Given: a paid account and authenticated user
      const account = await accountRepo.create({
        name: "Portal Org",
        slug: "portal-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_test",
        "sub_test",
        Plan.Pro,
      );
      const user = await userRepo.create({
        email: "portal@example.com",
        name: "Portal User",
        githubId: 12354,
        githubLogin: "portaluser",
        avatarUrl: null,
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I request portal with HTMX
      const response = await app.inject({
        method: "POST",
        url: "/api/billing/portal",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "hx-request": "true",
        },
        payload: {
          returnUrl: "/settings/billing",
        },
      });

      // Then: I get HX-Redirect header
      expect(response.statusCode).toBe(200);
      expect(response.headers["hx-redirect"]).toBe(
        "https://billing.stripe.com/test",
      );
    });
  });
});
