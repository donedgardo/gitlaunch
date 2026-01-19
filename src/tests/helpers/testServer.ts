import Fastify, { FastifyInstance } from "fastify";
import { registerPlugins } from "../../server/registerPlugins";
import healthRoute from "../../server/health";
import { DbClientI } from "../../server/health/dbClientI";

/**
 * Creates a minimal test server with health and static routes.
 * No database connection required - uses mock client.
 */
export function createTestServer(): FastifyInstance {
  const server = Fastify();

  // Register plugins (includes static file serving)
  registerPlugins(server);

  // Mock MongoDB client that always returns OK
  const mockMongoClient: DbClientI = {
    connect: async () => {},
  };

  // Register health route with mock client
  server.register(healthRoute(mockMongoClient));

  return server;
}
