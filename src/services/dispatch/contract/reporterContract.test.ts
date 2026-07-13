import { describe, it, expect } from "vitest";
import contract from "./reporter-contract.golden.json";
import { DeploymentStatus } from "../../service/deploymentStatus";
import { outcomeToStatus, CIOutcome } from "../deployStatus";

describe("reporter contract (server side)", () => {
  it("should map every CI outcome to the status fixed by the golden vector", () => {
    for (const [outcome, status] of Object.entries(contract.outcomeToStatus)) {
      expect(outcomeToStatus(outcome as CIOutcome)).toBe(status);
    }
  });

  it("should keep the golden status vocabulary in lockstep with the DeploymentStatus enum", () => {
    expect([...contract.statusVocabulary].sort()).toEqual(
      Object.values(DeploymentStatus).sort(),
    );
  });

  it("should only expose reporter statuses that are legal deployment statuses", () => {
    const vocabulary = Object.values(DeploymentStatus) as string[];
    for (const status of contract.reporterStatuses) {
      expect(vocabulary).toContain(status);
    }
  });

  it("should pin the REST endpoint shapes the reporter depends on", () => {
    expect(contract.endpoints.reportBuild).toEqual({
      method: "POST",
      path: "/api/v1/services/{serviceId}/builds",
    });
    expect(contract.endpoints.updateDeploymentStatus).toEqual({
      method: "PATCH",
      path: "/api/v1/services/{serviceId}/builds/{buildId}/deploy/{environment}",
    });
  });
});
