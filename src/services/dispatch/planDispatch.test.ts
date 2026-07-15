import { describe, it, expect } from "vitest";
import {
  planDispatch,
  planJenkinsDispatch,
  ValidationError,
} from "./planDispatch";

describe("planDispatch", () => {
  const validService = { workflowFile: "deploy-backend.yml" };
  const validRepo = { githubOwner: "org", githubRepoName: "repo" };
  const installationId = 12345;

  it("should return a GitHubDispatchPlan when all inputs are valid", () => {
    // Given/When
    const result = planDispatch(
      validService,
      installationId,
      validRepo,
      "build-123",
      "staging",
      "svc-abc",
    );

    // Then
    expect(result).toEqual({
      kind: "github",
      installationId: 12345,
      owner: "org",
      repo: "repo",
      workflowFile: "deploy-backend.yml",
      buildId: "build-123",
      environment: "staging",
      serviceId: "svc-abc",
    });
  });

  it("should return a ValidationError when installationId is null", () => {
    // Given/When
    const result = planDispatch(
      validService,
      null as unknown as number,
      validRepo,
      "build-123",
      "staging",
      "svc-abc",
    );

    // Then
    expect((result as ValidationError).kind).toBe("validation-error");
    expect((result as ValidationError).reason).toBe(
      "GitHub App not installed for this account",
    );
  });
});

describe("planJenkinsDispatch", () => {
  const connection = { baseUrl: "https://ci.acme.com", username: "deploy-bot" };
  const token = "jenkins-token";

  it("should return a JenkinsDispatchPlan when all inputs are valid", () => {
    const result = planJenkinsDispatch(
      connection,
      token,
      "deploy-backend",
      "build-123",
      "staging",
      "svc-abc",
    );

    expect(result).toEqual({
      kind: "jenkins",
      baseUrl: "https://ci.acme.com",
      username: "deploy-bot",
      apiToken: "jenkins-token",
      jobName: "deploy-backend",
      buildId: "build-123",
      environment: "staging",
      serviceId: "svc-abc",
    });
  });

  it("should return a ValidationError when the connection is missing", () => {
    const result = planJenkinsDispatch(
      null,
      token,
      "deploy-backend",
      "build-123",
      "staging",
      "svc-abc",
    );

    expect((result as ValidationError).kind).toBe("validation-error");
    expect((result as ValidationError).reason).toBe(
      "Jenkins is not connected for this account",
    );
  });

  it("should return a ValidationError when the token is missing", () => {
    const result = planJenkinsDispatch(
      connection,
      null,
      "deploy-backend",
      "build-123",
      "staging",
      "svc-abc",
    );

    expect((result as ValidationError).kind).toBe("validation-error");
    expect((result as ValidationError).reason).toBe(
      "Jenkins is not connected for this account",
    );
  });

  it("should return a ValidationError when the job name is missing", () => {
    const result = planJenkinsDispatch(
      connection,
      token,
      null,
      "build-123",
      "staging",
      "svc-abc",
    );

    expect((result as ValidationError).kind).toBe("validation-error");
    expect((result as ValidationError).reason).toBe(
      "Jenkins job name is not configured for this service",
    );
  });
});
