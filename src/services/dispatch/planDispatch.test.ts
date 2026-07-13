import { describe, it, expect } from "vitest";
import { planDispatch, ValidationError } from "./planDispatch";

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
