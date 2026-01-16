import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { AccountRepository } from "../../../repositories/accountRepository";
import { UserRepository } from "../../../repositories/userRepository";
import {
  StripeService,
  StripeClient,
} from "../../../services/billing/stripeService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
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
    const membershipRepo = new MembershipRepository(db);
    stripeService = new StripeService(new FakeStripeClient(), {
      proPriceId: "price_pro",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });
    planService = new PlanEnforcementService(
      accountRepo,
      repoRepo,
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
    sessionAuthMiddleware(app, sessionService);
    registerBillingRoutes(app, {
      stripeService,
      planEnforcementService: planService,
      accountRepo,
      userRepo,
    });
    await app.ready();
  });

  describe("POST /api/billing/checkout", () => {
    it("should return checkout URL for authenticated user", async () => {
      // Given: an account and authenticated user
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      const user = await userRepo.create({
        email: "user@example.com",
        name: "Test User",
        githubId: 12345,
        githubUsername: "testuser",
      });
      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: I request checkout
      const response = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        cookies: {
          session: sessionToken,
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
      await accountRepo.upgradeToPaid(account._id, "cus_test", "sub_test");
      const user = await userRepo.create({
        email: "paid@example.com",
        name: "Paid User",
        githubId: 12346,
        githubUsername: "paiduser",
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
        githubUsername: "freeuser",
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
        githubUsername: "usageuser",
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
      expect(body.plan).toBe("free");
    });
  });
});
