import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { createMockServer } from "../test.helpers";

describe("Health Routes", () => {
  let server: FastifyInstance;
  beforeEach(() => {
    server = createMockServer();
  });
  afterAll(() => {
    server.close();
  });
  it("should return status OK for /health route", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "OK" });
  });
});
