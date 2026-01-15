import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createMockServer, testEnvironments } from "../test.helpers";
import * as cheerio from "cheerio";

describe("Dashboard Routes", () => {
  let server: FastifyInstance;
  let response: LightMyRequestResponse;
  beforeEach(() => {
    server = createMockServer();
  });
  afterAll(() => {
    server.close();
  });
  describe("/dashboard", () => {
    describe("Unauthenticated user", () => {
      it("should redirect to /", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/dashboard",
          cookies: {
            authToken: "",
          },
        });
        expect(response.statusCode).toEqual(302);
        expect(response.headers["location"]).toEqual("/");
      });
    });
    describe("Authenticated user", () => {
      beforeEach(async () => {
        response = await server.inject({
          method: "GET",
          url: "/dashboard",
          cookies: {
            authToken: "token",
          },
        });
      });
      it("should redirect to first service", () => {
        expect(response.statusCode).toEqual(302);
        expect(response.headers["location"]).toEqual("/dashboard/service-a");
      });
    });
  });
  describe("/dashboard/:service-name:", () => {
    describe("Unauthenticated user", () => {
      beforeEach(async () => {
        response = await server.inject({
          method: "GET",
          url: "/dashboard/service-a",
          cookies: {
            authToken: "",
          },
        });
      });
      it("should redirect /", async () => {
        expect(response.statusCode).toEqual(302);
        expect(response.headers["location"]).toEqual("/");
      });
    });
    describe("Authenticated user", () => {
      beforeEach(async () => {
        response = await server.inject({
          method: "GET",
          url: "/dashboard/service-a",
          cookies: {
            authToken: "token",
          },
        });
      });
      it("should show table headers for each environment", () => {
        const $ = cheerio.load(response.body);
        for (const env of testEnvironments) {
          const environmentHeader = $("th").filter(function () {
            return $(this).text().trim() === env;
          });
          expect(environmentHeader.length).toBe(1);
        }
      });
      it("should show one build with the build id", () => {
        const $ = cheerio.load(response.body);
        const buildIdTableData = $("td").filter(function () {
          return $(this).text().trim() === "hash";
        });
        expect(buildIdTableData.length).toBe(1);
      });
      it("should show link to commit in the build ", () => {
        const $ = cheerio.load(response.body);
        const buildRow = $(`tr#hash`);
        const link = buildRow.find("a");
        const href = link.attr("href");
        expect(href).toMatch(/\/service-a\/commit\/hash$/);
      });
    });

    it("should show deploy button for builds for each env", () => {
      const $ = cheerio.load(response.body);
      for (const env of testEnvironments) {
        const devDeployButtonText = $(`td#service-a-hash-${env}`)
          .find("button")
          .text()
          .trim();
        expect(devDeployButtonText).toEqual("Deploy");
      }
    });
  });
});
