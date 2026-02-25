import Fastify, { FastifyInstance } from "fastify";
import { Db } from "mongodb";
import EventEmitter from "node:events";

import { registerPlugins } from "./registerPlugins";
import healthRoute from "./health";
import homeRoute from "./home";
import dashboardRoutes from "./dashboard";
import buildRoutes from "./build";
import { registerGitHubAuthRoutes } from "./routes/auth/github";
import { registerInstallationRoutes } from "./routes/github/installation";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerServiceRoutes } from "./routes/services";
import { registerSettingsRoutes } from "./routes/services/settings";
import { registerBuildsRoutes } from "./routes/api/builds";
import { registerEnvironmentsRoutes } from "./routes/api/environments";
import { registerSessionMiddleware } from "./middleware/sessionAuth";
import { createApiKeyAuthMiddleware } from "./middleware/apiKeyAuth";

import { GitHubOAuthService } from "../services/auth/githubOAuthService";
import { BuildRepository } from "../repositories/buildRepository";
import { BuildService } from "../services/build/buildService";
import { BuildDispatchService } from "../services/build/buildDispatchService";
import { MultiTenantGithubDispatchService } from "../services/github/githubDispatchService";
import { SessionService } from "../services/auth/sessionService";
import { UserRepository } from "../repositories/userRepository";
import { AccountRepository } from "../repositories/accountRepository";
import { MembershipRepository } from "../repositories/membershipRepository";
import { RepositoryRepository } from "../repositories/repositoryRepository";
import { ServiceRepository } from "../repositories/serviceRepository";
import { ApiKeyRepository } from "../repositories/apiKeyRepository";
import { WebhookEventRepository } from "../repositories/webhookEventRepository";
import { TrialRegistryRepository } from "../repositories/trialRegistryRepository";
import { GitHubAppService } from "../services/github/githubAppService";
import { InstallationTokenService } from "../services/github/installationTokenService";
import { ApiKeyService } from "../services/apiKey/apiKeyService";
import { EnvironmentService } from "../services/environment/environmentService";
import { PlanEnforcementService } from "../services/billing/planEnforcementService";
import { TrialService } from "../services/billing/trialService";
import { StripeWebhookHandler } from "../services/billing/webhookHandler";
import { StripeService } from "../services/billing/stripeService";
import { StripeApiClient } from "../services/billing/stripeApiClient";
import { registerStripeWebhookRoute } from "./routes/webhooks/stripe";
import { registerBillingRoutes } from "./routes/settings/billing";
import { DbClientI } from "./health/dbClientI";

export type AppServerDeps = {
  database: Db;
  mongoClient: DbClientI;
  eventEmitter: EventEmitter;
  githubOAuthService: GitHubOAuthService;
  sessionService: SessionService;
  gitHubAppService: GitHubAppService;
  installationTokenService: InstallationTokenService;
  webhookEventRepo?: WebhookEventRepository;
};

export function createAppServer(deps: AppServerDeps): FastifyInstance {
  const {
    database,
    mongoClient,
    eventEmitter,
    githubOAuthService,
    sessionService,
    gitHubAppService,
    installationTokenService,
    webhookEventRepo,
  } = deps;

  const server = Fastify();
  registerPlugins(server);

  // Repositories
  const userRepository = new UserRepository(database);
  const accountRepository = new AccountRepository(database);
  const membershipRepository = new MembershipRepository(database);
  const repositoryRepository = new RepositoryRepository(database);
  const serviceRepository = new ServiceRepository(database);
  const apiKeyRepository = new ApiKeyRepository(database);
  const buildRepository = new BuildRepository(database);
  const trialRegistryRepository = new TrialRegistryRepository(database);

  // Services
  const apiKeyService = new ApiKeyService(apiKeyRepository, accountRepository);
  const planEnforcementService = new PlanEnforcementService(
    accountRepository,
    repositoryRepository,
    serviceRepository,
    membershipRepository,
  );
  const trialService = new TrialService(
    accountRepository,
    trialRegistryRepository,
  );

  // GitHub dispatch service for triggering workflows
  const githubDispatchService = new MultiTenantGithubDispatchService(
    installationTokenService,
  );
  const buildDispatchService = new BuildDispatchService(
    accountRepository,
    repositoryRepository,
    serviceRepository,
    githubDispatchService,
  );
  const buildService = new BuildService(
    buildRepository,
    serviceRepository,
    eventEmitter,
    buildDispatchService,
  );
  const environmentService = new EnvironmentService(serviceRepository);

  // Webhook handler and route
  if (webhookEventRepo) {
    const webhookHandler = new StripeWebhookHandler(accountRepository);
    registerStripeWebhookRoute(server, {
      webhookHandler,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
      webhookEventRepo,
    });
  }

  // Session middleware (must be before routes that need request.session)
  registerSessionMiddleware(server, {
    sessionService,
  });

  // Billing services and routes (only if Stripe is configured)
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (stripeSecretKey) {
    const stripeApiClient = new StripeApiClient(stripeSecretKey);
    const stripeService = new StripeService(stripeApiClient, {
      proPriceId: process.env.STRIPE_PRO_PRICE_ID || "",
      teamPriceId: process.env.STRIPE_TEAM_PRICE_ID || "",
      successUrl:
        process.env.STRIPE_SUCCESS_URL ||
        `${process.env.PUBLIC_URL}/settings/billing?success=true`,
      cancelUrl:
        process.env.STRIPE_CANCEL_URL ||
        `${process.env.PUBLIC_URL}/settings/billing?cancelled=true`,
    });

    registerBillingRoutes(server, {
      stripeService,
      planEnforcementService,
      accountRepo: accountRepository,
      userRepo: userRepository,
      serviceRepo: serviceRepository,
    });
  }

  // Routes
  server.register(healthRoute(mongoClient));
  server.register(homeRoute());
  server.register(
    dashboardRoutes({
      serviceRepository,
      buildRepository,
      repositoryRepository,
      buildService,
      trialService,
      planEnforcementService,
    }),
  );
  server.register(
    buildRoutes({
      eventEmitter,
      serviceRepository,
    }),
  );

  // GitHub OAuth routes
  registerGitHubAuthRoutes(server, {
    oauthService: githubOAuthService,
    sessionService,
    userRepository,
    accountRepository,
    membershipRepository,
  });

  // GitHub App installation routes
  registerInstallationRoutes(server, {
    gitHubAppService,
  });

  // Onboarding routes
  registerOnboardingRoutes(server, {
    accountRepository,
    repositoryRepository,
    userRepository,
    gitHubAppService,
    planEnforcementService,
    trialService,
  });

  // Service management routes
  registerServiceRoutes(server, {
    accountRepository,
    repositoryRepository,
    serviceRepository,
    apiKeyService,
    githubAppService: gitHubAppService,
    planEnforcementService,
  });

  // Service settings routes (environments management)
  registerSettingsRoutes(server, {
    serviceRepository,
    repositoryRepository,
    environmentService,
    planEnforcementService,
  });

  // API v1 routes (API key authenticated)
  server.register(
    async (apiServer) => {
      // Add API key auth middleware for all /api/v1 routes
      const apiKeyAuth = createApiKeyAuthMiddleware(apiKeyService);
      apiServer.addHook("preHandler", apiKeyAuth);

      // Register builds API routes
      registerBuildsRoutes(apiServer, {
        buildService,
        serviceRepo: serviceRepository,
      });

      // Register environments API routes
      registerEnvironmentsRoutes(apiServer, {
        environmentService,
        planEnforcementService,
      });
    },
    { prefix: "" }, // Routes already have /api/v1 prefix
  );

  return server;
}
