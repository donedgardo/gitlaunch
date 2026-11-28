// Must stay the first import: it loads .env and registers the error-reporting
// SDK before the libraries it instruments (mongodb, http) are pulled in below.
import { errorReporter } from "./instrument";

import { MongoClient } from "mongodb";
import EventEmitter from "node:events";

import { createAppServer } from "./server/createAppServer";
import { MongoDbClient } from "./services/auth/mongoDbClient";
import { SessionService } from "./services/auth/sessionService";
import { AccountRepository } from "./repositories/accountRepository";
import { BuildRepository } from "./repositories/buildRepository";
import { ServiceRepository } from "./repositories/serviceRepository";
import { WebhookEventRepository } from "./repositories/webhookEventRepository";
import { TrialRegistryRepository } from "../ee/repositories/trialRegistryRepository";
import { LeadRepository } from "./repositories/leadRepository";
import { FlagRepository } from "./repositories/flagRepository";
import { FlagConfigVersionRepository } from "./repositories/flagConfigVersionRepository";
import { FlagChangeRepository } from "./repositories/flagChangeRepository";
import { createGitHubServices } from "./services/github/createGitHubServices";
import { createFlagCache } from "./services/flag/createFlagCache";
import { AnalyticsEventRepository } from "./repositories/analyticsEventRepository";
import { createAnalyticsService } from "./services/analytics/createAnalyticsService";
import { createPostHogClient } from "./services/analytics/createPostHogClient";
import { createGoogleOAuthService } from "./services/auth/googleOAuthService";
import { loadConfig, summarizeConfig, Config } from "./config/loadConfig";

// A bad configuration is an operator mistake, not a crash. Print the list of
// problems plainly and stop, rather than throwing a stack trace from module
// scope or — worse — booting with a feature silently missing.
function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    return process.exit(1);
  }
}

const config = loadConfigOrExit();

// What actually resolved, with secrets redacted. This is the first thing to
// ask for when someone reports a missing feature on a self-hosted install.
console.info(summarizeConfig(config));

// MongoDB connection
const client = new MongoClient(config.mongoUri);
const database = client.db("gitlaunch");

// Event emitter for SSE
const eventEmitter = new EventEmitter();

// Session service
const sessionService = new SessionService(config.cookieSecret);

// GitHub services
const accountRepository = new AccountRepository(database);
const { githubOAuthService, gitHubAppService, installationTokenService } =
  createGitHubServices(accountRepository, {
    useFakes: config.github.useFakes,
    clientId: config.github.clientId,
    clientSecret: config.github.clientSecret,
    appId: config.github.appId,
    privateKey: config.github.privateKey,
    publicUrl: config.publicUrl,
  });

// Google OAuth (optional). Left undefined when unconfigured so the button
// stays hidden rather than leading nowhere.
const googleOAuthService = config.features.googleAuth.enabled
  ? createGoogleOAuthService({
      useFakes: config.features.googleAuth.useFakes,
      clientId: config.features.googleAuth.clientId,
      clientSecret: config.features.googleAuth.clientSecret,
      publicUrl: config.publicUrl,
    })
  : undefined;

// Create WebhookEventRepository for webhook idempotency
const webhookEventRepository = new WebhookEventRepository(database);

// Analytics — one port, whichever destinations this instance is configured
// for: the Mongo warehouse, PostHog, both, or (in dev, with neither) the
// console. Emitters never learn which.
const analyticsEventRepository = new AnalyticsEventRepository(
  database,
  config.features.analytics.retentionDays,
);
const analytics = createAnalyticsService(analyticsEventRepository, {
  warehouse: config.features.analytics.enabled,
  posthog: createPostHogClient(config.features.analytics.posthog),
  dev: !config.isProduction,
});

// Flag evaluation cache (Redis when REDIS_URL is set, in-memory otherwise)
const flagCache = createFlagCache();

// Create server
const server = createAppServer({
  database,
  mongoClient: new MongoDbClient(client),
  eventEmitter,
  githubOAuthService,
  googleOAuthService,
  sessionService,
  gitHubAppService,
  installationTokenService,
  webhookEventRepo: webhookEventRepository,
  analytics,
  flagCache,
  errorReporter,
  config,
});

const PORT = config.port;

// Initialize indexes and start server
async function start() {
  // Ensure database indexes
  const buildRepository = new BuildRepository(database);
  const serviceRepository = new ServiceRepository(database);
  const trialRegistryRepository = new TrialRegistryRepository(database);
  const leadRepository = new LeadRepository(database);
  const flagRepository = new FlagRepository(database);
  const flagConfigVersionRepository = new FlagConfigVersionRepository(database);
  await buildRepository.ensureIndexes();
  await serviceRepository.ensureIndexes();
  await webhookEventRepository.ensureIndexes();
  await trialRegistryRepository.ensureIndexes();
  await analyticsEventRepository.ensureIndexes();
  await leadRepository.ensureIndexes();
  await flagRepository.ensureIndexes();
  await flagConfigVersionRepository.ensureIndexes();
  await new FlagChangeRepository(database).ensureIndexes();

  await server.listen({ host: "0.0.0.0", port: PORT });
  console.info(`Server listening on port ${PORT}`);
}

// A redeploy shouldn't cost us the events buffered since the last send. Both
// signals are handled: the platform sends SIGTERM, a local `yarn dev` SIGINT.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    await analytics.flush?.();
    await server.close();
    process.exit(0);
  });
}

start().catch(async (err) => {
  console.error("Failed to start server:", err);
  errorReporter.captureException(err, { phase: "startup" });
  // Give the report a chance to leave the process before we kill it.
  await errorReporter.flush(2000);
  process.exit(1);
});
