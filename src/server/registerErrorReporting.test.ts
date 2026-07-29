import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";

import { registerErrorReporting } from "./registerErrorReporting";
import { ErrorReporterI } from "../services/observability/errorReporter";

class RecordingReporter implements ErrorReporterI {
  public readonly enabled = true;
  public readonly captured: {
    error: unknown;
    context?: Record<string, unknown>;
  }[] = [];

  captureException(error: unknown, context?: Record<string, unknown>): void {
    this.captured.push({ error, context });
  }
}

describe("registerErrorReporting", () => {
  let server: FastifyInstance;
  let reporter: RecordingReporter;

  beforeEach(async () => {
    reporter = new RecordingReporter();
    server = Fastify();
    registerErrorReporting(server, reporter);
    server.get("/boom", async () => {
      throw new Error("route exploded");
    });
    server.get("/ok", async () => ({ ok: true }));
    server.get("/missing-service", async (_request, reply) =>
      reply.status(404).send({ error: "not found" }),
    );
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("should report errors thrown while handling a request", async () => {
    const response = await server.inject({ method: "GET", url: "/boom" });

    expect(response.statusCode).toBe(500);
    expect(reporter.captured).toHaveLength(1);
    expect((reporter.captured[0].error as Error).message).toBe(
      "route exploded",
    );
    expect(reporter.captured[0].context).toMatchObject({
      method: "GET",
      url: "/boom",
    });
  });

  it("should not report successful requests", async () => {
    await server.inject({ method: "GET", url: "/ok" });

    expect(reporter.captured).toHaveLength(0);
  });

  it("should not report handled error responses", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/missing-service",
    });

    expect(response.statusCode).toBe(404);
    expect(reporter.captured).toHaveLength(0);
  });
});
