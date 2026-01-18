import "dotenv/config";
import { MongoClient } from "mongodb";
import EventEmitter from "node:events";

import { createAppServer } from "./server/createAppServer";
import { createServices } from "./services/createServices";
import { MongoDbClient } from "./services/auth/mongoDbClient";
import {
  GitHubOAuthService,
  RealGitHubHttpClient,
} from "./services/auth/githubOAuthService";
import { SessionService } from "./services/auth/sessionService";
import { AccountRepository } from "./repositories/accountRepository";
import { GitHubAppService } from "./services/github/githubAppService";
import { GitHubAppClient } from "./services/github/githubAppClient";
import { InstallationTokenService } from "./services/github/installationTokenService";
import { RealGitHubApiClient } from "./services/github/githubApiClient";

// MongoDB connection
const mongodb_uri = process.env.MONGODB_URI as string;
const client = new MongoClient(mongodb_uri);
const database = client.db("gitlaunch");

// Event emitter for SSE
const eventEmitter = new EventEmitter();

// Legacy services (from SERVICES env var)
const serviceNames = process.env.SERVICES
  ? process.env.SERVICES.split(",").map((s) => s.trim())
  : [];
const services = createServices(serviceNames, database, eventEmitter);

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
const gitHubAppClient = new GitHubAppClient({
  appId: process.env.GH_APP_ID as string,
  privateKey: process.env.GH_APP_PRIVATE_KEY as string,
});
const installationTokenService = new InstallationTokenService(gitHubAppClient);
const gitHubApiClient = new RealGitHubApiClient();
const gitHubAppService = new GitHubAppService(
  accountRepository,
  installationTokenService,
  gitHubApiClient,
);

// Create server
const server = createAppServer({
  database,
  mongoClient: new MongoDbClient(client),
  eventEmitter,
  services,
  githubOAuthService,
  sessionService,
  gitHubAppService,
});

const PORT = parseInt(process.env.PORT || "3050");

server.listen({ host: "0.0.0.0", port: PORT }).then(() => {
  console.info(`Server listening on port ${PORT}`);
});
