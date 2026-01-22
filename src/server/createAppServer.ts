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
import { registerBuildsRoutes } from "./routes/api/builds";
import { registerSessionMiddleware } from "./middleware/sessionAuth";
import { createApiKeyAuthMiddleware } from "./middleware/apiKeyAuth";

import { GitHubOAuthService } from "../services/auth/githubOAuthService";
import { BuildRepository } from "../repositories/buildRepository";
import { BuildService } from "../services/build/buildService";
import { NoOpBuildDispatchService } from "../services/build/buildDispatchService";
import { SessionService } from "../services/auth/sessionService";
import { UserRepository } from "../repositories/userRepository";
import { AccountRepository } from "../repositories/accountRepository";
import { MembershipRepository } from "../repositories/membershipRepository";
import { RepositoryRepository } from "../repositories/repositoryRepository";
import { ServiceRepository } from "../repositories/serviceRepository";
import { ApiKeyRepository } from "../repositories/apiKeyRepository";
import { GitHubAppService } from "../services/github/githubAppService";
import { ApiKeyService } from "../services/apiKey/apiKeyService";
import { PlanEnforcementService } from "../services/billing/planEnforcementService";
import { ServiceI } from "../services/service/interface";
import { DbClientI } from "./health/dbClientI";

export type AppServerDeps = {
  database: Db;
  mongoClient: DbClientI;
  eventEmitter: EventEmitter;
  services: ServiceI[];
  githubOAuthService: GitHubOAuthService;
  sessionService: SessionService;
  gitHubAppService: GitHubAppService;
};

export function createAppServer(deps: AppServerDeps): FastifyInstance {
  const {
    database,
    mongoClient,
    eventEmitter,
    services,
    githubOAuthService,
    sessionService,
    gitHubAppService,
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

  // Services
  const apiKeyService = new ApiKeyService(apiKeyRepository, accountRepository);
  const planEnforcementService = new PlanEnforcementService(
    accountRepository,
    repositoryRepository,
    membershipRepository,
  );

  // No-op dispatcher for now - use BuildDispatchService for actual GitHub dispatch
  const buildDispatchService = new NoOpBuildDispatchService();
  const buildService = new BuildService(
    buildRepository,
    serviceRepository,
    eventEmitter,
    buildDispatchService,
  );

  // Session middleware
  registerSessionMiddleware(server, {
    sessionService,
  });

  // Routes
  server.register(healthRoute(mongoClient));
  server.register(homeRoute());
  server.register(
    dashboardRoutes({
      serviceRepository,
      buildRepository,
    }),
  );
  server.register(
    buildRoutes({
      services,
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
    gitHubAppService,
    planEnforcementService,
  });

  // Service management routes
  registerServiceRoutes(server, {
    accountRepository,
    repositoryRepository,
    serviceRepository,
    apiKeyService,
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
    },
    { prefix: "" }, // Routes already have /api/v1 prefix
  );

  return server;
}
