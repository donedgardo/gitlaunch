import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { createTestServer } from "./helpers/testServer";

describe("Public folder", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = createTestServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("serves js htmx library", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/public/js/htmx.min.js",
    });

    expect(response.statusCode).toBe(200);
  });
});
