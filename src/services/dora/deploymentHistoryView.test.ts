import { describe, it, expect } from "vitest";
import { DeploymentStatus } from "../service/deploymentStatus";
import { DeploymentAttempt } from "./deploymentHistory";
import { toDeploymentHistoryView } from "./deploymentHistoryView";

describe("toDeploymentHistoryView", () => {
  const attempt = (
    overrides: Partial<DeploymentAttempt> = {},
  ): DeploymentAttempt => ({
    buildId: "abc1234def",
    environment: "prod",
    status: DeploymentStatus.DEPLOYED,
    startedAt: new Date("2026-08-01T10:00:00Z"),
    finishedAt: new Date("2026-08-01T10:06:00Z"),
    durationMs: 6 * 60 * 1000,
    intent: "promote",
    ...overrides,
  });

  it("should read a landed deployment as deployed, with how long it took", () => {
    // Given: a deploy that took six minutes
    const [entry] = toDeploymentHistoryView([attempt()]);

    // Then: a person can read the row without knowing our status enum
    expect(entry.statusLabel).toBe("Deployed");
    expect(entry.duration).toBe("6m");
    expect(entry.environment).toBe("prod");
    expect(entry.buildId).toBe("abc1234def");
  });

  it("should timestamp the row from when the deployment settled", () => {
    // Given: a deploy that started at 10:00 and finished at 10:06
    const [entry] = toDeploymentHistoryView([attempt()]);

    // Then: the row is dated when it landed — that is the moment people
    // remember, not when the pipeline was kicked off
    expect(entry.at).toEqual(new Date("2026-08-01T10:06:00Z"));
  });

  it("should date an unfinished deployment from when it started", () => {
    // Given: a deploy still running
    const [entry] = toDeploymentHistoryView([
      attempt({
        status: DeploymentStatus.DEPLOYING,
        finishedAt: null,
        durationMs: null,
      }),
    ]);

    // Then: the only time we have is when it began
    expect(entry.at).toEqual(new Date("2026-08-01T10:00:00Z"));
    expect(entry.statusLabel).toBe("Deploying");
    expect(entry.inFlight).toBe(true);
  });

  it("should leave the duration blank rather than claim a deployment was instant", () => {
    // Given: a deploy we only ever heard about once
    const [entry] = toDeploymentHistoryView([
      attempt({ durationMs: null, finishedAt: null }),
    ]);

    // Then: no duration is shown at all
    expect(entry.duration).toBe("—");
  });

  it("should call a failed deployment failed", () => {
    // Given: a deploy that errored
    const [entry] = toDeploymentHistoryView([
      attempt({ status: DeploymentStatus.ERROR }),
    ]);

    // Then: the row says so, and is marked as a failure for styling
    expect(entry.statusLabel).toBe("Failed");
    expect(entry.failed).toBe(true);
  });

  it("should mark a rollback as a rollback", () => {
    // Given: a deploy that undid a previous one
    const [entry] = toDeploymentHistoryView([attempt({ intent: "rollback" })]);

    // Then: the row can be picked out of the list at a glance — a rollback
    // is the most interesting line in any deployment history
    expect(entry.isRollback).toBe(true);
  });

  it("should not mark an unknown intent as a rollback", () => {
    // Given: a deploy that did not start here, so we never recorded why
    const [entry] = toDeploymentHistoryView([attempt({ intent: undefined })]);

    // Then: absence of evidence is not a rollback
    expect(entry.isRollback).toBe(false);
  });

  it("should call a cancelled deployment cancelled", () => {
    // Given: a deploy someone stopped
    const [entry] = toDeploymentHistoryView([
      attempt({ status: DeploymentStatus.CANCELLED }),
    ]);

    // Then: it is neither a success nor a failure
    expect(entry.statusLabel).toBe("Cancelled");
    expect(entry.failed).toBe(false);
    expect(entry.inFlight).toBe(false);
  });
});
