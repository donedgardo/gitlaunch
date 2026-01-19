import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { createTestServer } from "./helpers/testServer";

describe("Smoke Test", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = createTestServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("checks if the server responds to the health check", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("OK");
  });
});
