import { FastifyInstance } from "fastify";
import { DbClientI } from "./dbClientI";

export default function (dbClient: DbClientI) {
  return function (server: FastifyInstance, opts: any, done: any) {
    // Readiness: can this replica actually serve a request? It depends on
    // Mongo, so a database outage takes replicas out of the load balancer.
    server.get("/health", async (req, reply) => {
      try {
        await dbClient.connect();
        reply.send({ status: "OK" });
      } catch (e) {
        return reply.status(500).send({ status: "Unhealthy" });
      }
    });

    // Liveness: is the process itself alive? Deliberately touches no
    // dependency. Pointing a liveness probe at Mongo would restart every
    // replica during a database blip, turning a recoverable outage into a
    // crash loop that also destroys the evidence.
    server.get("/health/live", async (req, reply) => {
      reply.send({ status: "OK" });
    });

    done();
  };
}
