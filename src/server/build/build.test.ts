import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance, LightMyRequestResponse } from "fastify";
import {
  createMockServer,
  mockAuthService,
  mockBackendService,
  mockBuildId,
  testEnvironments,
} from "../test.helpers";
import { DeploymentStatus } from "../../services/service/deploymentStatus";
import http from "http";

describe("Build API routes", () => {
  let server: FastifyInstance;
  beforeEach(() => {
    server = createMockServer();
  });
  afterAll(() => {
    server.close();
  });

  describe("Post /api/:service/build/:buildId/:env/:status", () => {
    const method = "PATCH";
    const serviceName = mockBackendService.getName();
    const env = "staging";
    const status = DeploymentStatus.DEPLOYING;
    const url = `/api/${serviceName}/build/${mockBuildId}/${env}/${status}`;
    mockAuthService.setApiKey("valid-key");
    describe("Unauthenticated request", () => {
      it("should return 403 status", async () => {
        const headers = {
          "x-api-key": "",
        };
        const response = await sendRequest(method, url, headers);
        expectNotAuthorized(response);
      });
    });
    describe("Unauthorized request", () => {
      it("should return 403 status", async () => {
        const headers = {
          "x-api-key": "invalid",
        };
        const response = await sendRequest(method, url, headers);
        expectNotAuthorized(response);
      });
    });
    describe("Authorized request", () => {
      const header = {
        "x-api-key": "valid-key",
      };
      malformedAPIShould404(method, header, serviceName);
      it("should return html with status", async () => {
        const response = await sendRequest(method, url, header);
        console.log(response.body);
        expect(response.statusCode).toEqual(200);
        expect(response.headers["content-type"]).toEqual(
          "text/html; charset=utf-8",
        );
        expect(response.body).toContain(status);
      });
    });
  });
  describe("Post /api/:service/build/:buildId", () => {
    const method = "POST";
    const serviceName = mockBackendService.getName();
    const newBuildId = "new-build-id";
    const url = `/api/${serviceName}/build/${newBuildId}`;
    mockAuthService.setApiKey("valid-key");
    describe("Unauthorized request", () => {
      it("should return 403 status", async () => {
        const headers = {
          "x-api-key": "invalid",
        };
        const response = await sendRequest(method, url, headers);
        expectNotAuthorized(response);
      });
    });
    describe("Authenticated user", () => {
      let response: LightMyRequestResponse;
      beforeEach(async () => {
        const headers = {
          "x-api-key": "valid-key",
        };
        response = await sendRequest(method, url, headers);
      });
      it("responds with 200 status", async () => {
        expect(response.statusCode).toEqual(200);
      });
      it("responds with 200 status", async () => {
        const build = await mockBackendService.findOne(newBuildId);
        expect(build).toBeTruthy();
      });
    });
  });
  describe("Patch /:service/build/:buildId/:env/:status", () => {
    const method = "PATCH";
    const serviceName = mockBackendService.getName();
    const url = `/${serviceName}/build/${mockBuildId}/${testEnvironments[0]}/${DeploymentStatus.DISPATCHING}`;
    describe("Unauthenticated user", () => {
      it("should redirect to /", async () => {
        const header = {
          authorization: "Bearer",
        };
        const response = await sendRequest(method, url, header);
        expectNotAuthorized(response);
      });
    });
    describe("Authorized request", () => {
      const header = {
        authorization: "Bearer token",
      };
      malformedAPIShould404(method, header, serviceName);
      it("should return html with status", async () => {
        const response = await sendRequest(method, url, header);
        expect(response.statusCode).toEqual(200);
        expect(response.headers["content-type"]).toEqual(
          "text/html; charset=utf-8",
        );
        expect(response.body).toContain(DeploymentStatus.DISPATCHING);
      });
    });
  });
  async function sendRequest(
    method: "POST" | "PATCH" | "GET",
    url: string,
    headers: http.IncomingHttpHeaders | http.OutgoingHttpHeaders,
  ) {
    return server.inject({
      method,
      url,
      headers,
    });
  }
  function expectNotAuthorized(response: LightMyRequestResponse) {
    expect(response.statusCode).toEqual(403);
    expect(response.body).toEqual("Not Authorized");
  }
  function malformedAPIShould404(
    method: "GET" | "POST" | "PATCH",
    header: http.IncomingHttpHeaders | http.OutgoingHttpHeaders,
    serviceName: string,
    rootPath: string = "",
  ) {
    describe("with Malformed API", () => {
      describe("invalid service", () => {
        const url = `${rootPath}/wrong-service/build/${mockBuildId}/${testEnvironments[0]}/${DeploymentStatus.DISPATCHING}`;
        it("should return malformed request error", async () => {
          const response = await sendRequest(method, url, header);
          expect(response.statusCode).toEqual(404);
        });
      });
      describe("invalid build ", () => {
        const url = `${rootPath}/${serviceName}/build/wrong-build/${testEnvironments[0]}/${DeploymentStatus.DISPATCHING}`;
        it("should return malformed request error", async () => {
          const response = await sendRequest(method, url, header);
          expect(response.statusCode).toEqual(404);
        });
      });
      describe("invalid environment ", () => {
        const url = `${rootPath}/${serviceName}/build/${mockBuildId}/wrong-env/${DeploymentStatus.DISPATCHING}`;
        it("should return malformed request error", async () => {
          const response = await sendRequest(method, url, header);
          expect(response.statusCode).toEqual(404);
        });
      });
      describe("invalid deployment status", () => {
        const url = `${rootPath}/${serviceName}/build/${mockBuildId}/${testEnvironments[0]}/wrong-status`;
        it("should return malformed request error", async () => {
          const response = await sendRequest(method, url, header);
          expect(response.statusCode).toEqual(404);
        });
      });
    });
  }
});
