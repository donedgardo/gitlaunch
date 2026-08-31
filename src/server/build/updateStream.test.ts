import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import EventEmitter from "node:events";
import http from "node:http";
import { AddressInfo } from "node:net";
import buildRoutes from "./index";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { FastifySSEPlugin } from "fastify-sse-v2";
import * as Handlebars from "handlebars";
import { registerHandlebarsHelpers } from "../registerHandlebarsHelpers";

// build-update-stream broadcasts render-ready HTML for every build:update
// event to every open connection. The only thing standing between one
// account's deploy activity and every OTHER signed-in account's dashboard is
// the accountId filter these tests exercise — this route can't be driven
// through fastify.inject() (its response never ends on its own), so it's
// tested against a real listening socket instead.
describe("GET /build-update-stream", () => {
  let server: FastifyInstance;
  let eventEmitter: EventEmitter;
  let baseUrl: string;
  const ownAccountId = new ObjectId();
  const otherAccountId = new ObjectId();

  beforeEach(async () => {
    registerHandlebarsHelpers();
    Handlebars.registerPartial("buildEnvironmentAction", "{{serviceName}}");

    eventEmitter = new EventEmitter();
    server = Fastify();
    await server.register(FastifySSEPlugin);
    server.decorateRequest("session", null);
    server.addHook("preHandler", (req, _res, done) => {
      (req as any).session = { accountId: ownAccountId.toString() };
      done();
    });
    await server.register(
      buildRoutes({
        eventEmitter,
        serviceRepository: {} as ServiceRepository,
      }),
    );
    await server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = server.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.close();
  });

  function readStreamUntil(
    path: string,
    predicate: (buffered: string) => boolean,
    timeoutMs = 2000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get(`${baseUrl}${path}`, (res) => {
        let buffered = "";
        const timer = setTimeout(() => {
          req.destroy();
          reject(new Error(`timed out waiting for stream data: ${buffered}`));
        }, timeoutMs);
        res.on("data", (chunk: Buffer) => {
          buffered += chunk.toString();
          if (predicate(buffered)) {
            clearTimeout(timer);
            req.destroy();
            resolve(buffered);
          }
        });
        res.on("error", reject);
      });
      req.on("error", reject);
    });
  }

  it("should only forward build:update events belonging to the caller's own account", async () => {
    const streamPromise = readStreamUntil("/build-update-stream", (buf) =>
      buf.includes("own-account-service"),
    );

    // Give the SSE connection a moment to attach its listener before emitting.
    await new Promise((resolve) => setTimeout(resolve, 50));

    eventEmitter.emit("build:update", [
      {
        buildId: "other-build",
        environment: "prod",
        status: "deployed",
        accountId: otherAccountId.toString(),
        serviceId: "svc-other",
        serviceName: "other-account-service",
        canDispatch: true,
      },
      {
        buildId: "own-build",
        environment: "prod",
        status: "deployed",
        accountId: ownAccountId.toString(),
        serviceId: "svc-own",
        serviceName: "own-account-service",
        canDispatch: true,
      },
    ]);

    const streamed = await streamPromise;
    expect(streamed).toContain("own-account-service");
    expect(streamed).not.toContain("other-account-service");
  });

  it("should cap concurrent connections per account rather than allow an unbounded number", async () => {
    const openSockets: http.ClientRequest[] = [];
    function openConnection(): Promise<number> {
      return new Promise((resolve, reject) => {
        const req = http.get(`${baseUrl}/build-update-stream`, (res) => {
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        openSockets.push(req);
      });
    }

    try {
      const statuses: number[] = [];
      // One more than the cap, all from the same account, all left open.
      for (let i = 0; i < 11; i++) {
        statuses.push(await openConnection());
      }

      expect(statuses.filter((s) => s === 200)).toHaveLength(10);
      expect(statuses.filter((s) => s === 429)).toHaveLength(1);
    } finally {
      for (const req of openSockets) req.destroy();
    }
  });

  it("should return 403 when not authenticated", async () => {
    const unauthServer = Fastify();
    await unauthServer.register(FastifySSEPlugin);
    unauthServer.decorateRequest("session", null);
    await unauthServer.register(
      buildRoutes({
        eventEmitter,
        serviceRepository: {} as ServiceRepository,
      }),
    );
    await unauthServer.ready();

    const response = await unauthServer.inject({
      method: "GET",
      url: "/build-update-stream",
    });

    expect(response.statusCode).toBe(403);
    await unauthServer.close();
  });
});
