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
import { registerSessionMiddleware } from "./middleware/sessionAuth";

import { GitHubOAuthService } from "../services/auth/githubOAuthService";
import { SessionService } from "../services/auth/sessionService";
import { UserRepository } from "../repositories/userRepository";
import { AccountRepository } from "../repositories/accountRepository";
import { MembershipRepository } from "../repositories/membershipRepository";
import { RepositoryRepository } from "../repositories/repositoryRepository";
import { GitHubAppService } from "../services/github/githubAppService";
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

  // Session middleware
  registerSessionMiddleware(server, {
    sessionService,
  });

  // Routes
  server.register(healthRoute(mongoClient));
  server.register(homeRoute(services));
  server.register(dashboardRoutes(services));
  server.register(buildRoutes(services, eventEmitter));

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
  });

  return server;
}
