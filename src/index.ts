import "dotenv/config";
import { MongoClient } from "mongodb";
import EventEmitter from "node:events";

import { createAppServer } from "./server/createAppServer";
import { MongoDbClient } from "./services/auth/mongoDbClient";
import {
  GitHubOAuthService,
  RealGitHubHttpClient,
} from "./services/auth/githubOAuthService";
import { SessionService } from "./services/auth/sessionService";
import { AccountRepository } from "./repositories/accountRepository";
import { BuildRepository } from "./repositories/buildRepository";
import { ServiceRepository } from "./repositories/serviceRepository";
import { GitHubAppService } from "./services/github/githubAppService";
import { GitHubAppClient } from "./services/github/githubAppClient";
import { InstallationTokenService } from "./services/github/installationTokenService";
import { RealGitHubApiClient } from "./services/github/githubApiClient";
import { MockGitHubApiClient } from "./services/github/mockGitHubApiClient";
import { MockInstallationTokenService } from "./services/github/mockInstallationTokenService";

// MongoDB connection
const mongodb_uri = process.env.MONGODB_URI as string;
const client = new MongoClient(mongodb_uri);
const database = client.db("gitlaunch");

// Event emitter for SSE
const eventEmitter = new EventEmitter();

// GitHub OAuth service
const githubHttpClient = new RealGitHubHttpClient(
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
const isE2ETestMode = process.env.E2E_TEST_MODE === "true";

let gitHubAppService: GitHubAppService;
if (isE2ETestMode) {
  // Use mock clients for e2e tests
  const mockTokenService = new MockInstallationTokenService();
  const mockApiClient = new MockGitHubApiClient();
  gitHubAppService = new GitHubAppService(
    accountRepository,
    mockTokenService as unknown as InstallationTokenService,
    mockApiClient,
  );
  console.info("E2E Test Mode: Using mock GitHub API client");
} else {
  // Use real clients for production
  const gitHubAppClient = new GitHubAppClient({
    appId: process.env.GH_APP_ID as string,
    privateKey: process.env.GH_APP_PRIVATE_KEY as string,
  });
  const installationTokenService = new InstallationTokenService(
    gitHubAppClient,
  );
  const gitHubApiClient = new RealGitHubApiClient();
  gitHubAppService = new GitHubAppService(
    accountRepository,
    installationTokenService,
    gitHubApiClient,
  );
}

// Create server
const server = createAppServer({
  database,
  mongoClient: new MongoDbClient(client),
  eventEmitter,
  services: [], // Multi-tenant: services are per-account, not global
  githubOAuthService,
  sessionService,
  gitHubAppService,
});

const PORT = parseInt(process.env.PORT || "3050");

// Initialize indexes and start server
async function start() {
  // Ensure database indexes
  const buildRepository = new BuildRepository(database);
  const serviceRepository = new ServiceRepository(database);
  await buildRepository.ensureIndexes();
  await serviceRepository.ensureIndexes();

  await server.listen({ host: "0.0.0.0", port: PORT });
  console.info(`Server listening on port ${PORT}`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
