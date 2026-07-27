import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import healthRoute from "./index";
import { DbClientI } from "./dbClientI";

// A stand-in for the Mongo client that can be made to fail on demand — the
// whole point of these probes is what happens when the database is unreachable.
class StubDbClient implements DbClientI {
  public reachable = true;
  async connect(): Promise<void> {
    if (!this.reachable) {
      throw new Error("connection refused");
    }
  }
}

describe("health routes", () => {
  let server: FastifyInstance;
  let db: StubDbClient;

  beforeEach(async () => {
    db = new StubDbClient();
    server = Fastify();
    server.register(healthRoute(db));
    await server.ready();
  });

  describe("readiness (/health)", () => {
    it("should report OK while the database is reachable", async () => {
      // Given a healthy database
      // When the readiness probe runs
      const response = await server.inject({ method: "GET", url: "/health" });

      // Then the pod is ready to take traffic
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "OK" });
    });

    it("should fail while the database is unreachable", async () => {
      // Given Mongo is down
      db.reachable = false;

      // When the readiness probe runs
      const response = await server.inject({ method: "GET", url: "/health" });

      // Then the pod is pulled out of the load balancer
      expect(response.statusCode).toBe(500);
    });
  });

  describe("liveness (/health/live)", () => {
    it("should report OK when the process is running", async () => {
      // Given a running process
      // When the liveness probe runs
      const response = await server.inject({
        method: "GET",
        url: "/health/live",
      });

      // Then it passes
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "OK" });
    });

    it("should keep passing while the database is unreachable", async () => {
      // Given Mongo is down — a dependency outage, not a broken process
      db.reachable = false;

      // When the liveness probe runs
      const response = await server.inject({
        method: "GET",
        url: "/health/live",
      });

      // Then the pod is NOT restarted. Restarting every replica during a
      // database blip turns a recoverable outage into a crash loop.
      expect(response.statusCode).toBe(200);
    });
  });
});
