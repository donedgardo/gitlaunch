import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createMockServer } from "../test.helpers";

describe("Auth routes", () => {
  let server: FastifyInstance;
  beforeEach(() => {
    server = createMockServer();
  });
  afterAll(() => {
    server.close();
  });
  describe("logout", () => {
    let response: LightMyRequestResponse;
    beforeEach(async () => {
      const token = "token";
      response = await server.inject({
        method: "GET",
        url: "/logout",
        cookies: {
          authToken: token,
        },
      });
    });
    it("should clear authToken cookie ", async () => {
      expect(response.headers["set-cookie"]).toContain("authToken=");
    });
    it("should redirect / ", async () => {
      expect(response.statusCode).toEqual(302);
      expect(response.headers["location"]).toEqual("/");
    });
  });
});
