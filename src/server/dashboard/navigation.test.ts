import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createMockServer } from "../test.helpers";

describe("Dashboard Navigation", () => {
  let server: FastifyInstance;
  let response: LightMyRequestResponse;
  beforeEach(async () => {
    server = createMockServer();
    response = await server.inject({
      method: "GET",
      url: "/dashboard/service-a",
      cookies: {
        authToken: "token",
      },
    });
  });
  afterAll(() => {
    server.close();
  });
  it("should show the logout button", () => {
    expect(response.body).toMatch(/Logout/);
  });
  it("should show service-b", () => {
    expect(response.body).toMatch(/service-b/);
  });
  it("should show the service-a", () => {
    expect(response.body).toMatch(/service-a/);
  });
  it("should underline active service", () => {
    const $ = cheerio.load(response.body);
    const backendServiceLink = $("a").filter(function () {
      return $(this).text().trim() === "service-a";
    });
    expect(backendServiceLink.hasClass("underline")).toBeTruthy();
  });
  it("should not show underline on inactive service", () => {
    const $ = cheerio.load(response.body);
    const frontendServiceLink = $("a").filter(function () {
      return $(this).text().trim() === "service-b";
    });
    expect(frontendServiceLink.hasClass("underline")).toBeFalsy();
  });
  it("should link to properly to each service", () => {
    const $ = cheerio.load(response.body);
    const frontendServiceLink = $("a").filter(function () {
      return $(this).text().trim() === "service-b";
    });
    const backendServiceLink = $("a").filter(function () {
      return $(this).text().trim() === "service-a";
    });
    expect(frontendServiceLink.attr("hx-get")).toEqual("/dashboard/service-b");
    expect(backendServiceLink.attr("hx-get")).toEqual("/dashboard/service-a");
  });
});
