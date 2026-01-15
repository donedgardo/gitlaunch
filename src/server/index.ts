import Fastify from "fastify";
import { registerPlugins } from "./registerPlugins";
import { OAuthServiceI } from "../services/auth/interface";
import authRoutes, { userAuthDecorator } from "./auth";
import healthRoute from "./health";
import homeRoute from "./home";
import dashboardRoutes from "./dashboard";
import buildRoutes from "./build";
import { ServiceI } from "../services/service/interface";
import EventEmitter from "node:events";

import { DbClientI } from "./health/dbClientI";

function createServer(
  authService: OAuthServiceI,
  eventEmitter: EventEmitter,
  services: ServiceI[] = [],
  mongoClient: DbClientI,
) {
  const server = Fastify();
  registerPlugins(server);
  userAuthDecorator(server, authService);
  server.register(authRoutes(authService));
  server.register(healthRoute(mongoClient));
  server.register(homeRoute(services));
  server.register(dashboardRoutes(services));
  server.register(buildRoutes(services, eventEmitter));
  return server;
}

export default createServer;
