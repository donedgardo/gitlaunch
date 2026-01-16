import { Account } from "../../repositories/accountRepository";

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
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSessionResult = {
  url: string;
  sessionId: string;
};

export type SubscriptionStatus = {
  status: string;
  currentPeriodEnd: Date;
};

export class StripeService {
  constructor(
    private stripeClient: StripeClient,
    private config: StripeServiceConfig,
  ) {}

  async createCheckoutSession(params: {
    account: Account;
    userEmail: string;
  }): Promise<CheckoutSessionResult> {
    const checkoutParams: Parameters<StripeClient["createCheckoutSession"]>[0] =
      {
        priceId: this.config.proPriceId,
        successUrl: this.config.successUrl,
        cancelUrl: this.config.cancelUrl,
        metadata: {
          accountId: params.account._id.toString(),
        },
      };

    // Use existing customer if available, otherwise use email
    if (params.account.stripeCustomerId) {
      checkoutParams.customerId = params.account.stripeCustomerId;
    } else {
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
