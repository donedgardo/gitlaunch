import { Account, Plan } from "../../repositories/accountRepository";
import {
  MembershipService,
  CheckoutSessionResult,
  SubscriptionStatus,
} from "./membershipService";

export interface StripeClient {
  createCheckoutSession(params: {
    customerId?: string;
    customerEmail?: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ url: string; id: string }>;

  createCustomer(params: {
    email: string;
    name: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string }>;

  createBillingPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  getSubscription(subscriptionId: string): Promise<{
    id: string;
    status: string;
    currentPeriodEnd: Date;
  }>;
}

export type StripeServiceConfig = {
  proPriceId: string;
  teamPriceId: string;
  successUrl: string;
  cancelUrl: string;
};

export class StripeService implements MembershipService {
  constructor(
    private stripeClient: StripeClient,
    private config: StripeServiceConfig,
  ) {}

  private getPriceIdForPlan(plan: Plan): string {
    switch (plan) {
      case Plan.Pro:
        return this.config.proPriceId;
      case Plan.Team:
        return this.config.teamPriceId;
      case Plan.Free:
        throw new Error("Cannot create checkout session for Free plan");
    }
  }

  async createCheckoutSession(params: {
    account: Account;
    userEmail: string | null;
    plan: Plan;
  }): Promise<CheckoutSessionResult> {
    const priceId = this.getPriceIdForPlan(params.plan);

    const checkoutParams: Parameters<StripeClient["createCheckoutSession"]>[0] =
      {
        priceId,
        successUrl: this.config.successUrl,
        cancelUrl: this.config.cancelUrl,
        metadata: {
          accountId: params.account._id.toString(),
          plan: params.plan,
        },
      };

    // Use existing customer if available, otherwise use email if provided
    // If no email, Stripe checkout will prompt the user for it
    if (params.account.stripeCustomerId) {
      checkoutParams.customerId = params.account.stripeCustomerId;
    } else if (params.userEmail) {
      checkoutParams.customerEmail = params.userEmail;
    }

    const session =
      await this.stripeClient.createCheckoutSession(checkoutParams);

    return {
      url: session.url,
      sessionId: session.id,
    };
  }

  async createBillingPortalSession(params: {
    account: Account;
    returnUrl: string;
  }): Promise<{ url: string }> {
    if (!params.account.stripeCustomerId) {
      throw new Error("Account has no Stripe customer");
    }

    return this.stripeClient.createBillingPortalSession({
      customerId: params.account.stripeCustomerId,
      returnUrl: params.returnUrl,
    });
  }

  async getSubscriptionStatus(
    account: Account,
  ): Promise<SubscriptionStatus | null> {
    if (!account.stripeSubscriptionId) {
      return null;
    }

    const subscription = await this.stripeClient.getSubscription(
      account.stripeSubscriptionId,
    );

    return {
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
    };
  }
}
