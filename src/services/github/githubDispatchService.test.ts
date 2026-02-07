import { describe, it, expect, beforeEach } from "vitest";
import {
  MultiTenantGithubDispatchService,
  DispatchInput,
} from "./githubDispatchService";
import {
  InstallationTokenService,
  IGitHubAppClient,
  InstallationToken,
} from "./installationTokenService";
import { IHttpClient } from "./githubAppClient";

// Fake GitHub App client
class FakeGitHubAppClient implements IGitHubAppClient {
  async getInstallationToken(
    _installationId: number,
  ): Promise<InstallationToken> {
    return {
      token: "ghs_installation_token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }
}

// Fake HTTP client to capture dispatch requests
class FakeHttpClient implements IHttpClient {
  public requests: { url: string; options: RequestInit }[] = [];
  public responseStatus = 204;

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    this.requests.push({ url, options: options ?? {} });
    return new Response(null, { status: this.responseStatus });
  }
}

describe("MultiTenantGithubDispatchService", () => {
  let fakeHttp: FakeHttpClient;
  let tokenService: InstallationTokenService;
  let service: MultiTenantGithubDispatchService;

  beforeEach(() => {
    fakeHttp = new FakeHttpClient();
    const fakeAppClient = new FakeGitHubAppClient();
    tokenService = new InstallationTokenService(fakeAppClient);
    service = new MultiTenantGithubDispatchService(tokenService, fakeHttp);
  });

  describe("dispatch", () => {
    it("should trigger workflow dispatch using the workflow_dispatch API", async () => {
      // Given: dispatch input with workflow file
      const input: DispatchInput = {
        installationId: 12345,
        owner: "my-org",
        repo: "my-repo",
        workflowFile: "deploy.yml",
        buildId: "build-123",
        environment: "staging",
        serviceId: "service-abc",
      };

      // When: I dispatch
      await service.dispatch(input);

      // Then: GitHub workflow_dispatch API was called
      expect(fakeHttp.requests).toHaveLength(1);
      expect(fakeHttp.requests[0].url).toBe(
        "https://api.github.com/repos/my-org/my-repo/actions/workflows/deploy.yml/dispatches",
      );
    });

    it("should use installation token in Authorization header", async () => {
      // Given: dispatch input
      const input: DispatchInput = {
        installationId: 12345,
        owner: "my-org",
        repo: "my-repo",
        workflowFile: "deploy.yml",
        buildId: "build-123",
        environment: "staging",
        serviceId: "service-abc",
      };

      // When: I dispatch
      await service.dispatch(input);

      // Then: Authorization header uses the installation token
      const headers = fakeHttp.requests[0].options.headers as Record<
        string,
        string
      >;
      expect(headers["Authorization"]).toBe("Bearer ghs_installation_token");
    });

    it("should send ref and inputs in workflow_dispatch format", async () => {
      // Given: dispatch input
      const input: DispatchInput = {
        installationId: 12345,
        owner: "my-org",
        repo: "my-repo",
        workflowFile: "deploy.yml",
        buildId: "build-456",
        environment: "prod",
        serviceId: "service-xyz",
      };

      // When: I dispatch
      await service.dispatch(input);

      // Then: body contains workflow_dispatch format with ref and inputs
      const body = JSON.parse(fakeHttp.requests[0].options.body as string);
      expect(body.ref).toBe("main");
      expect(body.inputs).toEqual({
        environment: "prod",
        buildId: "build-456",
        serviceId: "service-xyz",
      });
    });

    it("should throw error when dispatch fails", async () => {
      // Given: GitHub API will fail
      fakeHttp.responseStatus = 403;
      const input: DispatchInput = {
        installationId: 12345,
        owner: "my-org",
        repo: "my-repo",
        workflowFile: "deploy.yml",
        buildId: "build-123",
        environment: "staging",
        serviceId: "service-abc",
      };

      // When/Then: dispatch throws error
      await expect(service.dispatch(input)).rejects.toThrow(
        "Failed to dispatch workflow",
      );
    });
  });
});
