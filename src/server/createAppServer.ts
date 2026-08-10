import Fastify, { FastifyInstance } from "fastify";
import { Db, ObjectId } from "mongodb";
import EventEmitter from "node:events";

import { registerPlugins } from "./registerPlugins";
import { registerErrorReporting } from "./registerErrorReporting";
import { resolveEnvironmentName } from "../services/config/environmentName";
import { loadConfig, Config } from "../config/loadConfig";
import healthRoute from "./health";
import homeRoute from "./home";
import dashboardRoutes from "./dashboard";
import analyticsRoutes from "./analytics";
import buildRoutes from "./build";
import { AnalyticsQueryService } from "../services/analytics/analyticsQueryService";
import { registerGitHubAuthRoutes } from "./routes/auth/github";
import { registerGoogleAuthRoutes } from "./routes/auth/google";
import { registerEmailPasswordAuthRoutes } from "./routes/auth/emailPassword";
import { registerInstallationRoutes } from "./routes/github/installation";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerServiceRoutes } from "./routes/services";
import { registerSettingsRoutes } from "./routes/services/settings";
import { registerBuildsRoutes } from "./routes/api/builds";
import { registerEnvironmentsRoutes } from "./routes/api/environments";
import { registerFlagsRoutes } from "./routes/api/flags";
import { registerFlagsSettingsRoutes } from "./routes/settings/flags";
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
import { FlagRepository } from "../repositories/flagRepository";
import { FlagConfigVersionRepository } from "../repositories/flagConfigVersionRepository";
import { FlagService } from "../services/flag/flagService";
import { ExperimentResultsService } from "../services/flag/experimentResultsService";
import { FlagConfigVersionService } from "../services/flag/flagConfigVersionService";
import { FlagCacheI, InMemoryFlagCache } from "../services/flag/flagCache";
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
import { InstanceMode } from "../services/licensing/resolveEntitlement";
import { resolveInstanceMode } from "../services/licensing/instanceMode";
import {
  AnalyticsService,
  NoOpAnalytics,
} from "../services/analytics/analytics";
import {
  ErrorReporterI,
  NoOpErrorReporter,
} from "../services/observability/errorReporter";
import { LeadRepository } from "../repositories/leadRepository";
import { WaitlistService } from "../services/marketing/waitlistService";
import { InternalTraffic } from "../services/analytics/internalTraffic";
import { WaitlistExperiment } from "../services/marketing/waitlistExperiment";
import { SignupGate } from "../services/account/signupGate";
import {
  describeSelfFlagStatus,
  SelfFlagAccount,
} from "../services/flag/selfFlagContext";
import { registerWaitlistRoutes } from "./routes/marketing/waitlist";
import { registerLegalRoutes } from "./routes/legal";

// Minimum time (ms) a real person needs to read and fill the waitlist form.
// Submissions faster than this are treated as bots. See botDetection.ts.
const WAITLIST_MIN_ELAPSED_MS = 2500;

// Parse an env-provided id into an ObjectId, or undefined when unset/invalid so
// downstream features degrade gracefully instead of throwing at boot.
function toObjectId(value: string | undefined): ObjectId | undefined {
  if (value && ObjectId.isValid(value)) return new ObjectId(value);
  return undefined;
}

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
  // Read-through cache for flag evaluation. Defaults to an in-memory cache;
  // inject a RedisFlagCache to share the cache across instances.
  flagCache?: FlagCacheI;
  // Crash reporting for errors thrown while handling a request. Defaults to a
  // no-op; inject a Sentry-backed reporter (see createErrorReporter) to enable.
  errorReporter?: ErrorReporterI;
  // Whether this is the hosted SaaS or a licensed self-hosted install.
  // Defaults to reading the environment; injected in tests.
  instanceMode?: InstanceMode;
  // Validated runtime configuration. Defaults to loading and validating the
  // process environment; the composition root in src/index.ts loads it once and
  // passes it in so boot validates exactly once.
  config?: Config;
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
    flagCache = new InMemoryFlagCache(),
    errorReporter = new NoOpErrorReporter(),
    config = loadConfig(),
  } = deps;

  // Self-hosted installs are governed by their license rather than by Stripe.
  const licensing = resolveInstanceMode(process.env);
  const instanceMode = deps.instanceMode ?? licensing.mode;
  if (licensing.licenseError) {
    // Surfaced but never fatal — see resolveInstanceMode.
    console.warn(
      `GitLaunch license was not honoured: ${licensing.licenseError}`,
    );
  }

  assertEncryptionKey();

  const server = Fastify();
  registerPlugins(server, config.cookieSecret);
  registerErrorReporting(server, errorReporter);

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
  const flagRepository = new FlagRepository(database);
  const flagConfigVersionRepository = new FlagConfigVersionRepository(database);
  const analyticsQueryService = new AnalyticsQueryService(database);
  const experimentResultsService = new ExperimentResultsService(database);
  const flagConfigVersionService = new FlagConfigVersionService(
    flagRepository,
    flagConfigVersionRepository,
  );

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
    instanceMode,
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
  const flagService = new FlagService(
    flagRepository,
    serviceRepository,
    flagCache,
    flagConfigVersionService,
  );

  // Webhook handler and route
  if (webhookEventRepo) {
    const webhookHandler = new StripeWebhookHandler(accountRepository);
    registerStripeWebhookRoute(server, {
      webhookHandler,
      webhookSecret: config.features.billing.webhookSecret ?? "",
      webhookEventRepo,
      analytics,
    });
  }

  // Session middleware (must be before routes that need request.session)
  registerSessionMiddleware(server, {
    sessionService,
    cookieSecure: config.cookies.secure,
  });

  // Billing services and routes. Never registered on a self-hosted install:
  // entitlement there comes from the license, so a checkout flow would be both
  // meaningless and a way to grant plan limits we did not sell.
  const stripeSecretKey =
    instanceMode.kind === "saas" && config.features.billing.enabled
      ? config.features.billing.secretKey
      : undefined;
  if (stripeSecretKey) {
    const stripeApiClient = new StripeApiClient(stripeSecretKey);
    const stripeService = new StripeService(stripeApiClient, {
      proPriceId: config.features.billing.proPriceId ?? "",
      teamPriceId: config.features.billing.teamPriceId ?? "",
      successUrl: config.features.billing.successUrl,
      cancelUrl: config.features.billing.cancelUrl,
    });

    registerBillingRoutes(server, {
      publicUrl: config.publicUrl,
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
  registerGithubSettingsRoutes(server, {
    githubConnectionService,
    github: config.github,
  });

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
    publicUrl: config.publicUrl,
    teamManagementService,
    accountMembershipService,
    invitationRepository,
  });
  registerInviteRoutes(server, {
    cookieSecure: config.cookies.secure,
    publicUrl: config.publicUrl,
    invitationRepository,
    membershipRepository,
    accountRepository,
    sessionService,
  });

  // Setup wizard routes
  registerSetupRoutes(server, {
    buildSimulationEnabled: config.features.buildSimulation.enabled,
    serviceRepo: serviceRepository,
    buildRepo: buildRepository,
    analytics,
  });

  // GitLaunch's own service within its own platform: the service its
  // self-hosted feature flags live under. GitLaunch is effectively a customer
  // of its own flag service, so any internal feature that dogfoods flags (today:
  // the waitlist landing A/B test) shares this scope and differs only by flag
  // key. The owning account is derived from the service (a service belongs to
  // one account), so no account id is configured. Absent service => flags inert.
  // The environment label is the instance-wide one (GITLAUNCH_ENV, or the older
  // GITLAUNCH_FLAG_ENV), not a flags-only setting — the same label names this
  // instance in error reports. Unlabelled instances keep reading "prod", which
  // is what this scope has always defaulted to.
  const selfFlagContext = {
    serviceId: config.features.selfFlags.enabled
      ? toObjectId(config.features.selfFlags.serviceId)
      : undefined,
    environment: resolveEnvironmentName(process.env, "prod"),
  };

  // Every self-flag fails open, so a missing or malformed GITLAUNCH_SERVICE_ID
  // silently disables the signup gate and the landing A/B test — you create the
  // flag, flip it, and nothing happens, with nothing to see. Say so at boot.
  const selfFlagStatus = describeSelfFlagStatus(
    config.features.selfFlags.enabled
      ? config.features.selfFlags.serviceId
      : undefined,
    selfFlagContext.environment,
  );
  if (selfFlagStatus.live) {
    console.log(selfFlagStatus.message);
  } else {
    console.warn(selfFlagStatus.message);
  }

  // Dogfood our own feature flags to control our own front door: whether a
  // brand-new visitor may create an account (kill switch / gradual alpha
  // opening / allow-lists, all from the flags page). Fails open.
  const signupGate = new SignupGate(
    flagService,
    serviceRepository,
    analytics,
    selfFlagContext,
  );

  // Marketing: waitlist capture (bot-filtered, campaign-attributed). The same
  // service that scopes our own flags also names the account these events
  // belong to — without it they land in the warehouse untenanted and every
  // account-scoped query on /dashboard/analytics skips them.
  const waitlistService = new WaitlistService(
    leadRepository,
    analytics,
    { minElapsedMs: WAITLIST_MIN_ELAPSED_MS },
    new SelfFlagAccount(serviceRepository, selfFlagContext),
    InternalTraffic.fromEnv(),
  );

  // Marketing: dogfood our own feature flags to A/B test the landing-page copy.
  const waitlistExperiment = new WaitlistExperiment(
    flagService,
    serviceRepository,
    analytics,
    selfFlagContext,
  );

  // Routes
  server.register(healthRoute(mongoClient));
  server.register(
    homeRoute({
      experiment: waitlistExperiment,
      signupDoor: signupGate,
      publicUrl: config.publicUrl,
    }),
  );
  registerWaitlistRoutes(server, {
    waitlistService,
    experiment: waitlistExperiment,
  });
  // Public and unauthenticated by design — see the note in the module. Both the
  // landing-page footer and the review bots at GitHub, Stripe and Google need
  // these to resolve without a session.
  registerLegalRoutes(server, { publicUrl: config.publicUrl });
  server.register(
    dashboardRoutes({
      publicUrl: config.publicUrl,
      buildSimulationEnabled: config.features.buildSimulation.enabled,
      serviceRepository,
      buildRepository,
      repositoryRepository,
      accountRepository,
      buildService,
      trialService,
      planEnforcementService,
      analytics,
      flagService,
    }),
  );
  server.register(
    analyticsRoutes({
      analyticsQueryService,
      accountRepository,
      serviceRepository,
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
    cookieSecure: config.cookies.secure,
    useFakeGitHub: config.github.useFakes,
    oauthService: githubOAuthService,
    sessionService,
    userRepository,
    accountRepository,
    membershipRepository,
    invitationRepository,
    signupGate,
    analytics,
  });

  // Google OAuth routes (only when a Google client is configured)
  if (googleOAuthService) {
    registerGoogleAuthRoutes(server, {
      cookieSecure: config.cookies.secure,
      useFakeGoogle: config.features.googleAuth.useFakes,
      oauthService: googleOAuthService,
      sessionService,
      userRepository,
      accountRepository,
      membershipRepository,
      signupGate,
      analytics,
    });
  }

  // Email/password auth routes (login/signup pages, confirmation flow)
  registerEmailPasswordAuthRoutes(server, {
    cookieSecure: config.cookies.secure,
    sessionService,
    userRepository,
    accountRepository,
    membershipRepository,
    passwordService,
    emailSender,
    publicUrl: config.publicUrl,
    googleEnabled: !!googleOAuthService,
    signupGate,
    analytics,
  });

  // GitHub App installation routes
  registerInstallationRoutes(server, {
    githubConnectionService,
    analytics,
  });

  // Onboarding routes
  registerOnboardingRoutes(server, {
    cookieSecure: config.cookies.secure,
    publicUrl: config.publicUrl,
    github: config.github,
    buildSimulationEnabled: config.features.buildSimulation.enabled,
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
    cookieSecure: config.cookies.secure,
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
    publicUrl: config.publicUrl,
    serviceRepository,
    repositoryRepository,
    environmentService,
    planEnforcementService,
    analytics,
  });

  // Feature flags management UI (per-service)
  registerFlagsSettingsRoutes(server, {
    publicUrl: config.publicUrl,
    serviceRepository,
    flagService,
    apiKeyService,
    analytics,
    experimentResults: experimentResultsService,
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

      // Register feature flags API routes (CRUD + evaluation)
      registerFlagsRoutes(apiServer, {
        flagService,
        serviceRepo: serviceRepository,
        planEnforcementService,
        analytics,
        experimentResults: experimentResultsService,
        configVersions: flagConfigVersionService,
      });
    },
    { prefix: "" }, // Routes already have /api/v1 prefix
  );

  return server;
}
