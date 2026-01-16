import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { StripeWebhookHandler } from "../../../services/billing/webhookHandler";

export type StripeWebhookRouteDependencies = {
  webhookHandler: StripeWebhookHandler;
  webhookSecret: string;
  skipSignatureVerification?: boolean;
};

type StripeEvent = {
  type: string;
  data: {
    object: Record<string, any>;
  };
};

export function registerStripeWebhookRoute(
  app: FastifyInstance,
  deps: StripeWebhookRouteDependencies,
) {
  const { webhookHandler, skipSignatureVerification } = deps;

  app.post(
    "/webhooks/stripe",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // In production, verify signature using deps.webhookSecret
      // For testing, we skip verification when skipSignatureVerification is true
      if (!skipSignatureVerification) {
        const signature = request.headers["stripe-signature"];
        if (!signature) {
          return reply.status(400).send({ error: "Missing Stripe signature" });
        }
        // TODO: Implement actual signature verification with Stripe SDK
        // const event = stripe.webhooks.constructEvent(request.rawBody, signature, webhookSecret);
      }

      const event = request.body as StripeEvent;

      try {
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object;
            await webhookHandler.handleCheckoutCompleted({
              accountId: session.metadata.accountId,
              customerId: session.customer,
              subscriptionId: session.subscription,
            });
            break;
          }

          case "customer.subscription.deleted": {
            const subscription = event.data.object;
            await webhookHandler.handleSubscriptionDeleted({
              subscriptionId: subscription.id,
            });
            break;
          }

          case "invoice.payment_failed": {
            const invoice = event.data.object;
            await webhookHandler.handlePaymentFailed({
              subscriptionId: invoice.subscription,
              attemptCount: invoice.attempt_count || 1,
            });
            break;
          }

          case "invoice.payment_succeeded": {
            const invoice = event.data.object;
            await webhookHandler.handlePaymentSucceeded({
              subscriptionId: invoice.subscription,
            });
            break;
          }

          default:
            // Unknown event type - acknowledge but don't process
            break;
        }

        return { received: true };
      } catch (error) {
        console.error("Webhook handler error:", error);
        return reply.status(500).send({ error: "Webhook handler failed" });
      }
    },
  );
}
