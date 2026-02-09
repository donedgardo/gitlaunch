import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { StripeWebhookHandler } from "../../../services/billing/webhookHandler";
import { WebhookEventRepository } from "../../../repositories/webhookEventRepository";

export type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: Record<string, any>;
  };
};

export interface StripeSignatureVerifier {
  verify(payload: string, signature: string, secret: string): StripeEvent;
}

export type StripeWebhookRouteDependencies = {
  webhookHandler: StripeWebhookHandler;
  webhookSecret: string;
  skipSignatureVerification?: boolean;
  signatureVerifier?: StripeSignatureVerifier;
  webhookEventRepo?: WebhookEventRepository;
};

export function registerStripeWebhookRoute(
  app: FastifyInstance,
  deps: StripeWebhookRouteDependencies,
) {
  const {
    webhookHandler,
    webhookSecret,
    skipSignatureVerification,
    signatureVerifier,
    webhookEventRepo,
  } = deps;

  app.post(
    "/webhooks/stripe",
    { config: { rawBody: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      let event: StripeEvent;

      // If signatureVerifier is provided, use it for verification
      if (signatureVerifier) {
        const signature = request.headers["stripe-signature"] as string;
        if (!signature) {
          return reply.status(400).send({ error: "Missing Stripe signature" });
        }

        try {
          const rawBody =
            (request as any).rawBody ||
            (typeof request.body === "string"
              ? request.body
              : JSON.stringify(request.body));
          event = signatureVerifier.verify(rawBody, signature, webhookSecret);
        } catch {
          return reply.status(400).send({ error: "Invalid signature" });
        }
      } else if (!skipSignatureVerification) {
        // Legacy mode: check for signature header but no actual verification
        const signature = request.headers["stripe-signature"];
        if (!signature) {
          return reply.status(400).send({ error: "Missing Stripe signature" });
        }
        event = request.body as StripeEvent;
      } else {
        // Test mode: skip all verification
        event = request.body as StripeEvent;
      }

      // Idempotency check — skip if no repo provided (backward compatible for tests)
      if (webhookEventRepo) {
        const isNew = await webhookEventRepo.markAsProcessed(
          event.id,
          event.type,
          event.data.object,
        );
        if (!isNew) {
          // Duplicate event — acknowledge but don't process
          return { received: true };
        }
      }

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
