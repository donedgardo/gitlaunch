import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { StripeService } from "../../../services/billing/stripeService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { AccountRepository } from "../../../repositories/accountRepository";
import { UserRepository } from "../../../repositories/userRepository";

export type BillingRoutesDependencies = {
  stripeService: StripeService;
  planEnforcementService: PlanEnforcementService;
  accountRepo: AccountRepository;
  userRepo: UserRepository;
};

export function registerBillingRoutes(
  app: FastifyInstance,
  deps: BillingRoutesDependencies,
) {
  const { stripeService, planEnforcementService, accountRepo, userRepo } = deps;

  // Middleware to resolve account and user from session
  app.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return;
      }

      const accountId = new ObjectId(request.session.accountId);
      const userId = new ObjectId(request.session.userId);

      const [account, user] = await Promise.all([
        accountRepo.findById(accountId),
        userRepo.findById(userId),
      ]);

      if (account) {
        (request as any).account = account;
      }
      if (user) {
        (request as any).userEmail = user.email;
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
