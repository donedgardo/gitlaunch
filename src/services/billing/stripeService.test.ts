import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { StripeService, StripeClient } from "./stripeService";
import { Account, Plan } from "../../repositories/accountRepository";

// Fake Stripe client for testing
class FakeStripeClient implements StripeClient {
  public lastCheckoutParams: any = null;
  public lastPortalParams: any = null;
  public checkoutUrl = "https://checkout.stripe.com/pay/test_session_123";
  public portalUrl = "https://billing.stripe.com/session/test_portal_123";
  public customerId = "cus_test123";

  async createCheckoutSession(params: {
    customerId?: string;
    customerEmail?: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ url: string; id: string }> {
    this.lastCheckoutParams = params;
    return { url: this.checkoutUrl, id: "cs_test_123" };
  }

  async createCustomer(params: {
    email: string;
    name: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string }> {
    return { id: this.customerId };
  }

  async createBillingPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    this.lastPortalParams = params;
    return { url: this.portalUrl };
  }

  async getSubscription(subscriptionId: string): Promise<{
    id: string;
    status: string;
    currentPeriodEnd: Date;
  }> {
    return {
      id: subscriptionId,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
  }
}

describe("StripeService", () => {
  let stripeClient: FakeStripeClient;
  let service: StripeService;

  const mockAccount: Account = {
    _id: new ObjectId(),
    name: "Test Org",
    slug: "test-org",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    paymentFailedAt: null,
    plan: Plan.Free,
    planLimits: {
      maxRepositories: 1,
      maxServices: 1,
      maxUsers: 1,
      maxEnvironments: 2,
      publicReposOnly: true,
    },
    githubConnection: null,
    jenkinsConnection: null,
    trialEndsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    stripeClient = new FakeStripeClient();
    service = new StripeService(stripeClient, {
      proPriceId: "price_pro_monthly",
      teamPriceId: "price_team_monthly",
      successUrl: "https://app.example.com/billing/success",
      cancelUrl: "https://app.example.com/billing/cancel",
    });
  });

  describe("createCheckoutSession", () => {
    it("should return checkout URL for upgrade to pro plan", async () => {
      // Given: a free account
      const account = { ...mockAccount, plan: Plan.Free };

      // When: I start checkout for pro plan
      const result = await service.createCheckoutSession({
        account,
        userEmail: "user@example.com",
        plan: Plan.Pro,
      });

      // Then: I get a checkout URL
      expect(result.url).toBe(
        "https://checkout.stripe.com/pay/test_session_123",
      );
      expect(result.sessionId).toBe("cs_test_123");
    });

    it("should create Stripe customer if account doesn't have one", async () => {
      // Given: account without Stripe customer
      const account = { ...mockAccount, stripeCustomerId: null };

      // When: I start checkout
      await service.createCheckoutSession({
        account,
        userEmail: "new@example.com",
        plan: Plan.Pro,
      });

      // Then: checkout is created with customer email
      expect(stripeClient.lastCheckoutParams.customerEmail).toBe(
        "new@example.com",
      );
    });

    it("should use existing Stripe customer if account has one", async () => {
      // Given: account with existing Stripe customer
      const account = { ...mockAccount, stripeCustomerId: "cus_existing123" };

      // When: I start checkout
      await service.createCheckoutSession({
        account,
        userEmail: "user@example.com",
        plan: Plan.Pro,
      });

      // Then: checkout uses existing customer
      expect(stripeClient.lastCheckoutParams.customerId).toBe(
        "cus_existing123",
      );
      expect(stripeClient.lastCheckoutParams.customerEmail).toBeUndefined();
    });

    it("should include account ID in metadata", async () => {
      // Given: an account
      const account = { ...mockAccount };

      // When: I start checkout
      await service.createCheckoutSession({
        account,
        userEmail: "user@example.com",
        plan: Plan.Pro,
      });

      // Then: metadata includes account ID
      expect(stripeClient.lastCheckoutParams.metadata.accountId).toBe(
        account._id.toString(),
      );
    });

    it("should use configured price ID for pro plan", async () => {
      // Given: service configured with pro price
      const account = { ...mockAccount };

      // When: I start checkout for Pro plan
      await service.createCheckoutSession({
        account,
        userEmail: "user@example.com",
        plan: Plan.Pro,
      });

      // Then: correct price ID is used
      expect(stripeClient.lastCheckoutParams.priceId).toBe("price_pro_monthly");
    });

    it("should use teamPriceId when plan is Team", async () => {
      // Given: a free account
      const account = { ...mockAccount };

      // When: I start checkout for Team plan
      await service.createCheckoutSession({
        account,
        userEmail: "user@example.com",
        plan: Plan.Team,
      });

      // Then: Team price ID is used
      expect(stripeClient.lastCheckoutParams.priceId).toBe(
        "price_team_monthly",
      );
    });

    it("should throw error when plan is Free", async () => {
      // Given: a free account
      const account = { ...mockAccount };

      // When/Then: checkout with Free plan should fail
      await expect(
        service.createCheckoutSession({
          account,
          userEmail: "user@example.com",
          plan: Plan.Free,
        }),
      ).rejects.toThrow("Cannot create checkout session for Free plan");
    });

    it("should include plan in metadata", async () => {
      // Given: a free account
      const account = { ...mockAccount };

      // When: I start checkout for Pro plan
      await service.createCheckoutSession({
        account,
        userEmail: "user@example.com",
        plan: Plan.Pro,
      });

      // Then: metadata includes plan
      expect(stripeClient.lastCheckoutParams.metadata.plan).toBe("pro");
    });

    it("should allow checkout without email when user has no email", async () => {
      // Given: account without Stripe customer and user with no email
      const account = { ...mockAccount, stripeCustomerId: null };

      // When: I start checkout with null email
      const result = await service.createCheckoutSession({
        account,
        userEmail: null,
        plan: Plan.Pro,
      });

      // Then: checkout is created successfully (Stripe will collect email)
      expect(result.url).toBe(
        "https://checkout.stripe.com/pay/test_session_123",
      );
      // And: customerEmail is not set (Stripe will prompt for it)
      expect(stripeClient.lastCheckoutParams.customerEmail).toBeUndefined();
    });
  });

  describe("createBillingPortalSession", () => {
    it("should return portal URL for managing subscription", async () => {
      // Given: an account with Stripe customer
      const account = { ...mockAccount, stripeCustomerId: "cus_test123" };

      // When: I request billing portal
      const result = await service.createBillingPortalSession({
        account,
        returnUrl: "https://app.example.com/settings",
      });

      // Then: I get a portal URL
      expect(result.url).toBe(
        "https://billing.stripe.com/session/test_portal_123",
      );
    });

    it("should throw if account has no Stripe customer", async () => {
      // Given: account without Stripe customer
      const account = { ...mockAccount, stripeCustomerId: null };

      // When/Then: requesting portal fails
      await expect(
        service.createBillingPortalSession({
          account,
          returnUrl: "https://app.example.com/settings",
        }),
      ).rejects.toThrow("Account has no Stripe customer");
    });
  });

  describe("getSubscriptionStatus", () => {
    it("should return subscription details", async () => {
      // Given: an account with active subscription
      const account = {
        ...mockAccount,
        stripeCustomerId: "cus_test123",
        stripeSubscriptionId: "sub_test123",
      };

      // When: I get subscription status
      const result = await service.getSubscriptionStatus(account);

      // Then: I get subscription details
      expect(result).not.toBeNull();
      expect(result!.status).toBe("active");
      expect(result!.currentPeriodEnd).toBeInstanceOf(Date);
    });

    it("should return null if no subscription", async () => {
      // Given: account without subscription
      const account = { ...mockAccount, stripeSubscriptionId: null };

      // When: I get subscription status
      const result = await service.getSubscriptionStatus(account);

      // Then: null is returned
      expect(result).toBeNull();
    });
  });
});
