import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { StripeService } from "../../../services/billing/stripeService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import {
  AccountRepository,
  Plan,
} from "../../../repositories/accountRepository";
import { UserRepository } from "../../../repositories/userRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";

export type BillingRoutesDependencies = {
  stripeService: StripeService;
  planEnforcementService: PlanEnforcementService;
  accountRepo: AccountRepository;
  userRepo: UserRepository;
  serviceRepo: ServiceRepository;
};

export function registerBillingRoutes(
  app: FastifyInstance,
  deps: BillingRoutesDependencies,
) {
  const {
    stripeService,
    planEnforcementService,
    accountRepo,
    userRepo,
    serviceRepo,
  } = deps;

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

  // GET billing settings page
  app.get(
    "/settings/billing",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const account = (request as any).account;

      if (!account) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      try {
        const [usage, accountState, services] = await Promise.all([
          planEnforcementService.getUsage(account._id),
          planEnforcementService.getAccountState(account._id),
          serviceRepo.findByAccountId(account._id),
        ]);
        const serviceNames = services.map((s) => s.name);

        const isOnTrial =
          account.plan !== Plan.Free &&
          !account.stripeSubscriptionId &&
          accountState.trialDaysRemaining > 0;

        const templateData = {
          services: serviceNames,
          plan: account.plan.charAt(0).toUpperCase() + account.plan.slice(1),
          planLower: account.plan,
          isPaid: account.plan !== Plan.Free,
          hasSubscription: !!account.stripeSubscriptionId,
          hasStripeCustomer: !!account.stripeCustomerId,
          isOnTrial,
          trialDaysRemaining: accountState.trialDaysRemaining,
          paymentFailed: accountState.paymentFailed,
          gracePeriodDaysRemaining: accountState.gracePeriodDaysRemaining,
          usage: {
            repositories: {
              current: usage.repositories.current,
              limit: usage.repositories.limit,
              percentage: Math.round(
                (usage.repositories.current / usage.repositories.limit) * 100,
              ),
            },
            services: {
              current: usage.services.current,
              limit: usage.services.limit,
              percentage: Math.round(
                (usage.services.current / usage.services.limit) * 100,
              ),
            },
            users: {
              current: usage.users.current,
              limit: usage.users.limit,
              percentage: Math.round(
                (usage.users.current / usage.users.limit) * 100,
              ),
            },
          },
        };

        return reply.view("settings/billing", templateData, {
          layout: "/layouts/main.hbs",
        });
      } catch (error) {
        return reply
          .status(500)
          .send({ error: "Failed to load billing settings" });
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

      const { plan } = request.body as { plan?: string };

      // Validate plan
      if (!plan || !["pro", "team"].includes(plan.toLowerCase())) {
        return reply.status(400).send({
          error: "Invalid plan. Must be 'pro' or 'team'.",
        });
      }

      // Map plan string to Plan enum
      const planEnum = plan.toLowerCase() === "pro" ? Plan.Pro : Plan.Team;

      try {
        const result = await stripeService.createCheckoutSession({
          account,
          userEmail,
          plan: planEnum,
        });

        // Check if this is an HTMX request
        const isHtmxRequest = request.headers["hx-request"] === "true";

        if (isHtmxRequest) {
          // Return HX-Redirect header for HTMX
          reply.header("HX-Redirect", result.url);
          return reply.status(200).send();
        } else if (request.headers["content-type"]?.includes("json")) {
          // Return JSON for API clients
          return { checkoutUrl: result.url, sessionId: result.sessionId };
        } else {
          // Regular form POST — redirect to Stripe Checkout
          return reply.redirect(result.url);
        }
      } catch (error: any) {
        console.error("Checkout session error:", error?.message || error);
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
          returnUrl:
            body?.returnUrl || `${process.env.PUBLIC_URL}/settings/billing`,
        });

        // Check if this is an HTMX request
        const isHtmxRequest = request.headers["hx-request"] === "true";

        if (isHtmxRequest) {
          // Return HX-Redirect header for HTMX
          reply.header("HX-Redirect", result.url);
          return reply.status(200).send();
        } else {
          // Return JSON for non-HTMX clients
          return { portalUrl: result.url };
        }
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
