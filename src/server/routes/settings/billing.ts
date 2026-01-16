import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { StripeService } from "../../../services/billing/stripeService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { AccountRepository } from "../../../repositories/accountRepository";

export type BillingRoutesDependencies = {
  stripeService: StripeService;
  planEnforcementService: PlanEnforcementService;
  accountRepo: AccountRepository;
};

export function registerBillingRoutes(
  app: FastifyInstance,
  deps: BillingRoutesDependencies,
) {
  const { stripeService, planEnforcementService, accountRepo } = deps;

  // Test middleware to simulate authentication (for testing purposes)
  app.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accountIdHeader = request.headers["x-test-account-id"] as
        | string
        | undefined;
      const userEmail = request.headers["x-test-user-email"] as
        | string
        | undefined;

      if (accountIdHeader) {
        const account = await accountRepo.findById(
          new ObjectId(accountIdHeader),
        );
        if (account) {
          (request as any).account = account;
          (request as any).userEmail = userEmail || "test@example.com";
        }
      }
    },
  );

  // Create checkout session
  app.post(
    "/api/billing/checkout",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const account = (request as any).account;
      const userEmail = (request as any).userEmail;

      if (!account) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      try {
        const result = await stripeService.createCheckoutSession({
          account,
          userEmail,
        });

        return { checkoutUrl: result.url, sessionId: result.sessionId };
      } catch (error) {
        return reply
          .status(500)
          .send({ error: "Failed to create checkout session" });
      }
    },
  );

  // Create billing portal session
  app.post(
    "/api/billing/portal",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const account = (request as any).account;
      const body = request.body as { returnUrl?: string } | undefined;

      if (!account) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      if (!account.stripeCustomerId) {
        return reply
          .status(400)
          .send({ error: "No billing account found. Please upgrade first." });
      }

      try {
        const result = await stripeService.createBillingPortalSession({
          account,
          returnUrl: body?.returnUrl || "/settings",
        });

        return { portalUrl: result.url };
      } catch (error) {
        return reply
          .status(500)
          .send({ error: "Failed to create billing portal session" });
      }
    },
  );

  // Get current usage
  app.get(
    "/api/billing/usage",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const account = (request as any).account;

      if (!account) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      try {
        const usage = await planEnforcementService.getUsage(account._id);
        return usage;
      } catch (error) {
        return reply
          .status(500)
          .send({ error: "Failed to get usage information" });
      }
    },
  );
}
