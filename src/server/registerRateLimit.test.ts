import { describe, it, expect, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { registerRateLimit } from "./registerRateLimit";

describe("registerRateLimit", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("should allow requests under the configured limit", async () => {
    app = Fastify();
    registerRateLimit(app, { max: 2, timeWindowMs: 60_000 });
    app.after(() => {
      app.get("/ping", async () => "pong");
    });
    await app.ready();

    const first = await app.inject({ method: "GET", url: "/ping" });
    const second = await app.inject({ method: "GET", url: "/ping" });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });

  it("should reject requests once the same client exceeds the limit within the window", async () => {
    app = Fastify();
    registerRateLimit(app, { max: 2, timeWindowMs: 60_000 });
    // Routes must be registered inside app.after(): @fastify/rate-limit wires
    // itself up via an onRoute hook that only attaches once its own (async)
    // registration has actually run. Plugins registered via
    // fastify.register() are deferred until real boot regardless of whether
    // the caller awaits them, so a route added beforehand — the normal,
    // synchronous way this codebase registers routes — would silently get no
    // rate limiting at all. See the same comment in createAppServer.ts.
    app.after(() => {
      app.get("/ping", async () => "pong");
    });
    await app.ready();

    await app.inject({ method: "GET", url: "/ping" });
    await app.inject({ method: "GET", url: "/ping" });
    const third = await app.inject({ method: "GET", url: "/ping" });

    expect(third.statusCode).toBe(429);
  });

  it("should let a route opt into a stricter limit than the global default", async () => {
    app = Fastify();
    registerRateLimit(app, { max: 100, timeWindowMs: 60_000 });
    app.after(() => {
      app.post(
        "/auth/login",
        { config: { rateLimit: { max: 1, timeWindow: 60_000 } } },
        async () => "ok",
      );
    });
    await app.ready();

    await app.inject({ method: "POST", url: "/auth/login" });
    const second = await app.inject({ method: "POST", url: "/auth/login" });

    expect(second.statusCode).toBe(429);
  });
});
