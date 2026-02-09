import "dotenv/config";
import { MongoClient } from "mongodb";
import EventEmitter from "node:events";

import { createAppServer } from "./server/createAppServer";
import { MongoDbClient } from "./services/auth/mongoDbClient";
import {
  GitHubOAuthService,
  GitHubHttpClient,
} from "./services/auth/githubOAuthService";
import { SessionService } from "./services/auth/sessionService";
import { AccountRepository } from "./repositories/accountRepository";
import { BuildRepository } from "./repositories/buildRepository";
import { ServiceRepository } from "./repositories/serviceRepository";
import { WebhookEventRepository } from "./repositories/webhookEventRepository";
import { GitHubAppService } from "./services/github/githubAppService";
import { GitHubAppClient } from "./services/github/githubAppClient";
import { InstallationTokenService } from "./services/github/installationTokenService";
import { GitHubApiClient } from "./services/github/githubApiClient";

// MongoDB connection
const mongodb_uri = process.env.MONGODB_URI as string;
const client = new MongoClient(mongodb_uri);
const database = client.db("gitlaunch");

// Event emitter for SSE
const eventEmitter = new EventEmitter();

// GitHub OAuth service
const githubHttpClient = new GitHubHttpClient(
  process.env.GH_APP_CLIENT_ID as string,
  process.env.GH_APP_CLIENT_SECRET as string,
);
const githubOAuthService = new GitHubOAuthService(githubHttpClient, {
  clientId: process.env.GH_APP_CLIENT_ID,
  clientSecret: process.env.GH_APP_CLIENT_SECRET,
  redirectUri: `${process.env.PUBLIC_URL}/auth/github/callback`,
});

// Session service
const sessionService = new SessionService(
  process.env.COOKIE_SECRET_SIGNATURE as string,
);

// GitHub App service
const accountRepository = new AccountRepository(database);
const gitHubAppClient = new GitHubAppClient({
  appId: process.env.GH_APP_ID as string,
  privateKey: process.env.GH_APP_PRIVATE_KEY as string,
});
const installationTokenService = new InstallationTokenService(gitHubAppClient);
const gitHubApiClient = new GitHubApiClient();
const gitHubAppService = new GitHubAppService(
  accountRepository,
  installationTokenService,
  gitHubApiClient,
);

// Create WebhookEventRepository for webhook idempotency
const webhookEventRepository = new WebhookEventRepository(database);

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
});

const PORT = parseInt(process.env.PORT || "3050");

// Initialize indexes and start server
async function start() {
  // Ensure database indexes
  const buildRepository = new BuildRepository(database);
  const serviceRepository = new ServiceRepository(database);
  await buildRepository.ensureIndexes();
  await serviceRepository.ensureIndexes();
  await webhookEventRepository.ensureIndexes();

  await server.listen({ host: "0.0.0.0", port: PORT });
  console.info(`Server listening on port ${PORT}`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
