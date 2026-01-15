import { FastifyInstance } from "fastify";
import { DbClientI } from "./dbClientI";

export default function (dbClient: DbClientI) {
  return function (server: FastifyInstance, opts: any, done: any) {
    server.get("/health", async (req, reply) => {
      try {
        await dbClient.connect();
        reply.send({ status: "OK" });
      } catch (e) {
        return reply.status(500).send({ status: "Unhealthy" });
      }
    });
    done();
  };
}
