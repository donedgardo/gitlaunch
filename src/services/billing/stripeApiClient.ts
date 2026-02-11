import Stripe from "stripe";
import { StripeClient } from "./stripeService";

export class StripeApiClient implements StripeClient {
  private stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }

  async createCheckoutSession(params: {
    customerId?: string;
    customerEmail?: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ url: string; id: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
      customer: params.customerId,
      customer_email: params.customerId ? undefined : params.customerEmail,
    });

    if (!session.url) {
      throw new Error("Checkout session created but URL is missing");
    }

    return { url: session.url, id: session.id };
  }

  async createCustomer(params: {
    email: string;
    name: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: params.metadata,
    });
    return { id: customer.id };
  }

  async createBillingPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });
    return { url: session.url };
  }

  async getSubscription(subscriptionId: string): Promise<{
    id: string;
    status: string;
    currentPeriodEnd: Date;
  }> {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
    // Stripe API returns timestamps as Unix epoch seconds
    const periodEnd = (sub as any).current_period_end || Date.now() / 1000;
    return {
      id: sub.id,
      status: sub.status,
      currentPeriodEnd: new Date(periodEnd * 1000),
    };
  }
}
