import "dotenv/config";
import { MongoClient } from "mongodb";
import EventEmitter from "node:events";

import { createAppServer } from "./server/createAppServer";
import { MongoDbClient } from "./services/auth/mongoDbClient";
import { SessionService } from "./services/auth/sessionService";
import { AccountRepository } from "./repositories/accountRepository";
import { BuildRepository } from "./repositories/buildRepository";
import { ServiceRepository } from "./repositories/serviceRepository";
import { WebhookEventRepository } from "./repositories/webhookEventRepository";
import { TrialRegistryRepository } from "./repositories/trialRegistryRepository";
import { createGitHubServices } from "./services/github/createGitHubServices";
import { ConsoleAnalytics } from "./services/analytics/analytics";

// MongoDB connection
const mongodb_uri = process.env.MONGODB_URI as string;
const client = new MongoClient(mongodb_uri);
const database = client.db("gitlaunch");

// Event emitter for SSE
const eventEmitter = new EventEmitter();

// Session service
const sessionService = new SessionService(
  process.env.COOKIE_SECRET_SIGNATURE as string,
);

// GitHub services
const accountRepository = new AccountRepository(database);
const { githubOAuthService, gitHubAppService, installationTokenService } =
  createGitHubServices(accountRepository, {
    useFakes: process.env.USE_FAKE_GITHUB === "true",
    clientId: process.env.GH_APP_CLIENT_ID,
    clientSecret: process.env.GH_APP_CLIENT_SECRET,
    appId: process.env.GH_APP_ID,
    privateKey: process.env.GH_APP_PRIVATE_KEY,
    publicUrl: process.env.PUBLIC_URL,
  });

// Create WebhookEventRepository for webhook idempotency
const webhookEventRepository = new WebhookEventRepository(database);

// Analytics
const analytics = new ConsoleAnalytics();

// Create server
const server = createAppServer({
  database,
  mongoClient: new MongoDbClient(client),
  eventEmitter,
  githubOAuthService,
  sessionService,
  gitHubAppService,
  installationTokenService,
  webhookEventRepo: webhookEventRepository,
  analytics,
});

const PORT = parseInt(process.env.PORT || "3050");

// Initialize indexes and start server
async function start() {
  // Ensure database indexes
  const buildRepository = new BuildRepository(database);
  const serviceRepository = new ServiceRepository(database);
  const trialRegistryRepository = new TrialRegistryRepository(database);
  await buildRepository.ensureIndexes();
  await serviceRepository.ensureIndexes();
  await webhookEventRepository.ensureIndexes();
  await trialRegistryRepository.ensureIndexes();

  await server.listen({ host: "0.0.0.0", port: PORT });
  console.info(`Server listening on port ${PORT}`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
