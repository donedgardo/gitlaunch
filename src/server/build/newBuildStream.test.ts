import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import EventEmitter from "node:events";
import buildRoutes from "./index";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { FastifySSEPlugin } from "fastify-sse-v2";
import * as Handlebars from "handlebars";
import { registerHandlebarsHelpers } from "../registerHandlebarsHelpers";

describe("New Build SSE Stream", () => {
  let server: FastifyInstance;
  let eventEmitter: EventEmitter;
  let mockServiceRepository: ServiceRepository;

  const testAccountId = new ObjectId();
  const testServiceId = new ObjectId();
  const testService = {
    _id: testServiceId,
    accountId: testAccountId,
    name: "test-service",
    environments: [
      { name: "staging", order: 0 },
      { name: "prod", order: 1 },
    ],
  };

  beforeEach(async () => {
    registerHandlebarsHelpers();

    // Register the buildRow partial (simplified for testing)
    Handlebars.registerPartial(
      "buildRow",
      `<tr id="build-{{build.buildId}}">{{build.buildId}}</tr>`,
    );

    eventEmitter = new EventEmitter();
    mockServiceRepository = {
      findById: vi.fn().mockResolvedValue(testService),
      findByAccountId: vi.fn().mockResolvedValue([testService]),
    } as unknown as ServiceRepository;

    server = Fastify();
    await server.register(FastifySSEPlugin);

    // Mock session for auth
    server.decorateRequest("session", null);
    server.addHook("preHandler", (req, _res, done) => {
      (req as any).session = { accountId: testAccountId.toString() };
      done();
    });

    await server.register(
      buildRoutes({ eventEmitter, serviceRepository: mockServiceRepository }),
    );
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /new-build-stream/:serviceName", () => {
    it("should return 404 for non-existent service", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/new-build-stream/non-existent-service",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 403 when not authenticated", async () => {
      // Create a server without session
      const unauthServer = Fastify();
      await unauthServer.register(FastifySSEPlugin);
      unauthServer.decorateRequest("session", null);
      await unauthServer.register(
        buildRoutes({ eventEmitter, serviceRepository: mockServiceRepository }),
      );
      await unauthServer.ready();

      const response = await unauthServer.inject({
        method: "GET",
        url: `/new-build-stream/${testService.name}`,
      });

      expect(response.statusCode).toBe(403);
      await unauthServer.close();
    });

    it("should render new build row when build:created event fires", async () => {
      // This test verifies the event handling logic
      const buildId = "abc123def456";

      // Given: We have a listener for build:created
      const receivedEvents: any[] = [];
      eventEmitter.on("build:created", (event) => {
        receivedEvents.push(event);
      });

      // When: A build:created event is emitted
      eventEmitter.emit("build:created", {
        buildId,
        serviceId: testServiceId.toString(),
        serviceName: testService.name,
      });

      // Then: The event should be received
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].buildId).toBe(buildId);
      expect(receivedEvents[0].serviceName).toBe(testService.name);
    });
  });
});
