// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import {
  StripeSignatureVerifier,
  StripeEvent,
} from "../../server/routes/webhooks/stripe";

/**
 * Production implementation of StripeSignatureVerifier
 * Uses the Stripe SDK to verify webhook signatures
 *
 * Usage:
 * ```typescript
 * import Stripe from 'stripe';
 * const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
 * const verifier = new StripeWebhookSignatureVerifier(stripe);
 * ```
 */

type StripeInstance = {
  webhooks: {
    constructEvent(
      payload: string,
      signature: string,
      secret: string,
    ): StripeEvent;
  };
};

export class StripeWebhookSignatureVerifier implements StripeSignatureVerifier {
  constructor(private stripe: StripeInstance) {}

  verify(payload: string, signature: string, secret: string): StripeEvent {
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }
}
