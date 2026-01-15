import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createMockServer } from "../test.helpers";

describe("get /", () => {
  let server: FastifyInstance;
  beforeEach(() => {
    server = createMockServer();
  });
  afterAll(() => {
    server.close();
  });
  describe("Unauthenticated user", () => {
    it("should show login button", async () => {
      const token = "";
      const response = await server.inject({
        method: "GET",
        url: "/",
        cookies: {
          authToken: token,
        },
      });
      expect(response.body).toMatch(/Login/);
    });
  });
  describe("Authenticated user", () => {
    let response: LightMyRequestResponse;
    beforeEach(async () => {
      const token = "token";
      response = await server.inject({
        method: "GET",
        url: "/",
        cookies: {
          authToken: token,
        },
      });
    });
    it("should redirect to dashboard", async () => {
      expect(response.statusCode).toEqual(302);
      expect(response.headers["location"]).toEqual("/dashboard/service-a");
    });
  });
});
