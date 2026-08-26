import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { registerErrorSanitizer } from "./registerErrorSanitizer";

describe("registerErrorSanitizer", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    registerErrorSanitizer(app);

    app.get("/boom", async () => {
      throw new Error(
        'MongoServerError: E11000 duplicate key on gitlaunch.users index email_1 dup key: { email: "victim@acme.com" }',
      );
    });

    app.get("/teapot", async () => {
      const error = new Error("You asked for something silly") as Error & {
        statusCode?: number;
      };
      error.statusCode = 418;
      throw error;
    });

    app.post<{ Body: { count: number } }>(
      "/validated",
      {
        schema: {
          body: {
            type: "object",
            required: ["count"],
            properties: { count: { type: "number" } },
          },
        },
      },
      async () => ({ ok: true }),
    );

    await app.ready();
  });

  it("should not leak the message of an unexpected failure", async () => {
    // When a handler throws something that was never meant for the caller
    const response = await app.inject({ method: "GET", url: "/boom" });

    // Then the caller learns only that it failed
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal Server Error" });
    expect(response.body).not.toContain("victim@acme.com");
    expect(response.body).not.toContain("MongoServerError");
  });

  it("should never include a stack trace", async () => {
    // When a handler throws
    const response = await app.inject({ method: "GET", url: "/boom" });

    // Then no internal file paths reach the caller
    expect(response.body).not.toContain("at ");
    expect(response.body).not.toContain(".ts:");
  });

  it("should preserve deliberate client errors", async () => {
    // Given a handler that sets a 4xx status on the error it throws
    // When it is called
    const response = await app.inject({ method: "GET", url: "/teapot" });

    // Then the message survives — 4xx messages are written for the caller
    expect(response.statusCode).toBe(418);
    expect(response.json().error).toBe("You asked for something silly");
  });

  it("should preserve schema validation messages", async () => {
    // When a request fails validation
    const response = await app.inject({
      method: "POST",
      url: "/validated",
      payload: { count: "not-a-number" },
    });

    // Then the caller is told what was wrong with their request
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/count/);
  });
});
