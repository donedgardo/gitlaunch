import Fastify, { FastifyInstance } from "fastify";
import { Db } from "mongodb";
import EventEmitter from "node:events";

import { registerPlugins } from "./registerPlugins";
import healthRoute from "./health";
import homeRoute from "./home";
import dashboardRoutes from "./dashboard";
import buildRoutes from "./build";
import { registerGitHubAuthRoutes } from "./routes/auth/github";
import { registerGoogleAuthRoutes } from "./routes/auth/google";
import { registerEmailPasswordAuthRoutes } from "./routes/auth/emailPassword";
import { registerInstallationRoutes } from "./routes/github/installation";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerServiceRoutes } from "./routes/services";
import { registerSettingsRoutes } from "./routes/services/settings";
import { registerBuildsRoutes } from "./routes/api/builds";
import { registerEnvironmentsRoutes } from "./routes/api/environments";
import { registerSessionMiddleware } from "./middleware/sessionAuth";
import { createApiKeyAuthMiddleware } from "./middleware/apiKeyAuth";

import { GitHubOAuthService } from "../services/auth/githubOAuthService";
import { GoogleOAuthService } from "../services/auth/googleOAuthService";
import { PasswordService } from "../services/auth/passwordService";
import { EmailSender, createEmailSender } from "../services/email/emailSender";
import { BuildRepository } from "../repositories/buildRepository";
import { BuildService } from "../services/build/buildService";
import { BuildDispatchService } from "../services/build/buildDispatchService";
import { MultiTenantGithubDispatchService } from "../services/github/githubDispatchService";
import { GithubProviderDispatcher } from "../services/github/githubProviderDispatcher";
import { JenkinsDispatchService } from "../services/jenkins/jenkinsDispatchService";
import { JenkinsProviderDispatcher } from "../services/jenkins/jenkinsProviderDispatcher";
import { RawProviderDispatcher } from "../services/raw/rawProviderDispatcher";
import { RawDispatchService } from "../services/raw/rawDispatchService";
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
import { registerApiKeyRoutes } from "./routes/settings/apiKeys";
import { registerJenkinsSettingsRoutes } from "./routes/settings/jenkins";
import { registerGithubSettingsRoutes } from "./routes/settings/github";
import { registerTeamRoutes } from "./routes/settings/team";
import { registerInviteRoutes } from "./routes/invite";
import { InvitationRepository } from "../repositories/invitationRepository";
import { AccountMembershipService } from "../services/account/accountMembershipService";
import { TeamManagementService } from "../services/account/teamManagementService";
import { JenkinsConnectionService } from "../services/jenkins/jenkinsConnectionService";
import { GithubConnectionService } from "../services/github/githubConnectionService";
import { assertEncryptionKey } from "../services/crypto/secretBox";
import { registerSetupRoutes } from "./routes/dashboard/setup";
import { DbClientI } from "./health/dbClientI";
import {
  AnalyticsService,
  NoOpAnalytics,
} from "../services/analytics/analytics";
import { LeadRepository } from "../repositories/leadRepository";
import { WaitlistService } from "../services/marketing/waitlistService";
import { registerWaitlistRoutes } from "./routes/marketing/waitlist";

// Minimum time (ms) a real person needs to read and fill the waitlist form.
// Submissions faster than this are treated as bots. See botDetection.ts.
const WAITLIST_MIN_ELAPSED_MS = 2500;

export type AppServerDeps = {
  database: Db;
  mongoClient: DbClientI;
  eventEmitter: EventEmitter;
  githubOAuthService: GitHubOAuthService;
  googleOAuthService?: GoogleOAuthService;
  sessionService: SessionService;
  gitHubAppService: GitHubAppService;
  installationTokenService: InstallationTokenService;
  webhookEventRepo?: WebhookEventRepository;
  emailSender?: EmailSender;
  analytics?: AnalyticsService;
};

export function createAppServer(deps: AppServerDeps): FastifyInstance {
  const {
    database,
    mongoClient,
    eventEmitter,
    githubOAuthService,
    googleOAuthService,
    sessionService,
    gitHubAppService,
    installationTokenService,
    webhookEventRepo,
    emailSender = createEmailSender(),
    analytics = new NoOpAnalytics(),
  } = deps;

  assertEncryptionKey();

  const server = Fastify();
  registerPlugins(server);

  // Repositories
  const userRepository = new UserRepository(database);
  const accountRepository = new AccountRepository(database);
  const membershipRepository = new MembershipRepository(database);
  const invitationRepository = new InvitationRepository(database);
  const repositoryRepository = new RepositoryRepository(database);
  const serviceRepository = new ServiceRepository(database);
  const apiKeyRepository = new ApiKeyRepository(database);
  const buildRepository = new BuildRepository(database);
  const trialRegistryRepository = new TrialRegistryRepository(database);
  const leadRepository = new LeadRepository(database);

  // Services
  const apiKeyService = new ApiKeyService(apiKeyRepository, accountRepository);
  const passwordService = new PasswordService();
  const jenkinsConnectionService = new JenkinsConnectionService(
    accountRepository,
  );
  const githubConnectionService = new GithubConnectionService(
    accountRepository,
  );
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

  // Provider dispatch strategies for triggering deployments
  const githubDispatchService = new MultiTenantGithubDispatchService(
    installationTokenService,
  );
  const jenkinsDispatchService = new JenkinsDispatchService();
  const rawDispatchService = new RawDispatchService();
  const buildDispatchService = new BuildDispatchService(
    accountRepository,
    serviceRepository,
    [
      new GithubProviderDispatcher(repositoryRepository, githubDispatchService),
      new JenkinsProviderDispatcher(
        jenkinsConnectionService,
        jenkinsDispatchService,
      ),
      new RawProviderDispatcher(rawDispatchService),
    ],
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
      analytics,
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
      analytics,
    });
  }

  // API key management routes
  registerApiKeyRoutes(server, { apiKeyService, serviceRepository });
  registerJenkinsSettingsRoutes(server, { jenkinsConnectionService });
  registerGithubSettingsRoutes(server, { githubConnectionService });

  // Team: shareable-link invites into a shared workspace
  const accountMembershipService = new AccountMembershipService(
    membershipRepository,
    accountRepository,
    userRepository,
  );
  const teamManagementService = new TeamManagementService(
    membershipRepository,
    invitationRepository,
  );
  registerTeamRoutes(server, {
    teamManagementService,
    accountMembershipService,
    invitationRepository,
  });
  registerInviteRoutes(server, {
    invitationRepository,
    membershipRepository,
    accountRepository,
    sessionService,
  });

  // Setup wizard routes
  registerSetupRoutes(server, {
    serviceRepo: serviceRepository,
    buildRepo: buildRepository,
    analytics,
  });

  // Marketing: waitlist capture (bot-filtered, campaign-attributed)
  const waitlistService = new WaitlistService(leadRepository, analytics, {
    minElapsedMs: WAITLIST_MIN_ELAPSED_MS,
  });

  // Routes
  server.register(healthRoute(mongoClient));
  server.register(homeRoute());
  registerWaitlistRoutes(server, { waitlistService });
  server.register(
    dashboardRoutes({
      serviceRepository,
      buildRepository,
      repositoryRepository,
      accountRepository,
      buildService,
      trialService,
      planEnforcementService,
      analytics,
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
    invitationRepository,
    analytics,
  });

  // Google OAuth routes (only when a Google client is configured)
  if (googleOAuthService) {
    registerGoogleAuthRoutes(server, {
      oauthService: googleOAuthService,
      sessionService,
      userRepository,
      accountRepository,
      membershipRepository,
      analytics,
    });
  }

  // Email/password auth routes (login/signup pages, confirmation flow)
  registerEmailPasswordAuthRoutes(server, {
    sessionService,
    userRepository,
    accountRepository,
    membershipRepository,
    passwordService,
    emailSender,
    publicUrl: process.env.PUBLIC_URL || "",
    googleEnabled: !!googleOAuthService,
    analytics,
  });

  // GitHub App installation routes
  registerInstallationRoutes(server, {
    githubConnectionService,
    analytics,
  });

  // Onboarding routes
  registerOnboardingRoutes(server, {
    accountRepository,
    repositoryRepository,
    userRepository,
    serviceRepository,
    gitHubAppService,
    apiKeyService,
    planEnforcementService,
    trialService,
    analytics,
  });

  // Service management routes
  registerServiceRoutes(server, {
    accountRepository,
    repositoryRepository,
    serviceRepository,
    apiKeyService,
    githubAppService: gitHubAppService,
    planEnforcementService,
    analytics,
  });

  // Service settings routes (environments management)
  registerSettingsRoutes(server, {
    serviceRepository,
    repositoryRepository,
    environmentService,
    planEnforcementService,
    analytics,
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
        planEnforcementService,
        analytics,
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
