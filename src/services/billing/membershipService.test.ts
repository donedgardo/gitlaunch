import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  MembershipService,
  CheckoutSessionResult,
  SubscriptionStatus,
} from "./membershipService";
import { StripeService, StripeClient } from "./stripeService";
import { Account, Plan } from "../../repositories/accountRepository";

// Fake Stripe client for testing StripeService
class FakeStripeClient implements StripeClient {
  public checkoutUrl = "https://checkout.stripe.com/pay/test_session_123";
  public portalUrl = "https://billing.stripe.com/session/test_portal_123";

  async createCheckoutSession(params: {
    customerId?: string;
    customerEmail?: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ url: string; id: string }> {
    return { url: this.checkoutUrl, id: "cs_test_123" };
  }

  async createCustomer(params: {
    email: string;
    name: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string }> {
    return { id: "cus_test123" };
  }

  async createBillingPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
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

// Fake MembershipService to prove interface is implementation-agnostic
class FakeMembershipService implements MembershipService {
  async createCheckoutSession(params: {
    account: Account;
    userEmail: string | null;
  }): Promise<CheckoutSessionResult> {
    return {
      url: "https://fake-checkout.example.com",
      sessionId: "fake_session_123",
    };
  }

  async createBillingPortalSession(params: {
    account: Account;
    returnUrl: string;
  }): Promise<{ url: string }> {
    return {
      url: "https://fake-portal.example.com",
    };
  }

  async getSubscriptionStatus(
    account: Account,
  ): Promise<SubscriptionStatus | null> {
    if (!account.stripeSubscriptionId) {
      return null;
    }
    return {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
  }
}

describe("MembershipService interface", () => {
  const mockAccount: Account = {
    _id: new ObjectId(),
    name: "Test Org",
    slug: "test-org",
    stripeCustomerId: "cus_test123",
    stripeSubscriptionId: "sub_test123",
    paymentFailedAt: null,
    plan: Plan.Free,
    planLimits: {
      maxRepositories: 1,
      maxServices: 1,
      maxUsers: 1,
      maxEnvironments: 2,
      publicReposOnly: true,
    },
    githubInstallationId: null,
    githubInstallationAccessToken: null,
    githubInstallationTokenExpiresAt: null,
    jenkinsConnection: null,
    trialEndsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe("StripeService", () => {
    let service: MembershipService;

    beforeEach(() => {
      const stripeClient = new FakeStripeClient();
      service = new StripeService(stripeClient, {
        proPriceId: "price_pro_monthly",
        teamPriceId: "price_team_monthly",
        successUrl: "https://app.example.com/billing/success",
        cancelUrl: "https://app.example.com/billing/cancel",
      });
    });

    it("should implement MembershipService interface", async () => {
      // Given: StripeService instance assigned to MembershipService type
      const membershipService: MembershipService = service;

      // When: I call interface methods
      const checkoutResult = await membershipService.createCheckoutSession({
        account: mockAccount,
        userEmail: "user@example.com",
        plan: Plan.Pro,
      });

      const portalResult = await membershipService.createBillingPortalSession({
        account: mockAccount,
        returnUrl: "https://app.example.com/settings",
      });

      const statusResult =
        await membershipService.getSubscriptionStatus(mockAccount);

      // Then: All methods work as expected
      expect(checkoutResult.url).toBe(
        "https://checkout.stripe.com/pay/test_session_123",
      );
      expect(checkoutResult.sessionId).toBe("cs_test_123");
      expect(portalResult.url).toBe(
        "https://billing.stripe.com/session/test_portal_123",
      );
      expect(statusResult).not.toBeNull();
      expect(statusResult!.status).toBe("active");
    });
  });

  describe("FakeMembershipService", () => {
    let service: MembershipService;

    beforeEach(() => {
      service = new FakeMembershipService();
    });

    it("should satisfy MembershipService contract", async () => {
      // Given: A fake implementation assigned to MembershipService type
      const membershipService: MembershipService = service;

      // When: I call interface methods
      const checkoutResult = await membershipService.createCheckoutSession({
        account: mockAccount,
        userEmail: "user@example.com",
        plan: Plan.Pro,
      });

      const portalResult = await membershipService.createBillingPortalSession({
        account: mockAccount,
        returnUrl: "https://app.example.com/settings",
      });

      const statusResult =
        await membershipService.getSubscriptionStatus(mockAccount);

      // Then: All methods return expected types
      expect(checkoutResult).toHaveProperty("url");
      expect(checkoutResult).toHaveProperty("sessionId");
      expect(typeof checkoutResult.url).toBe("string");
      expect(typeof checkoutResult.sessionId).toBe("string");

      expect(portalResult).toHaveProperty("url");
      expect(typeof portalResult.url).toBe("string");

      expect(statusResult).not.toBeNull();
      expect(statusResult).toHaveProperty("status");
      expect(statusResult).toHaveProperty("currentPeriodEnd");
      expect(statusResult!.currentPeriodEnd).toBeInstanceOf(Date);
    });

    it("should handle accounts without subscriptions", async () => {
      // Given: Account without subscription
      const accountWithoutSub = { ...mockAccount, stripeSubscriptionId: null };

      // When: I get subscription status
      const result = await service.getSubscriptionStatus(accountWithoutSub);

      // Then: null is returned
      expect(result).toBeNull();
    });
  });
});
