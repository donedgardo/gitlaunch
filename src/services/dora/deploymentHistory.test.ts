import { describe, it, expect } from "vitest";
import { DeploymentStatus } from "../service/deploymentStatus";
import { DeploymentEvent } from "./fourKeys";
import { toDeploymentAttempts } from "./deploymentHistory";

describe("toDeploymentAttempts", () => {
  const at = (isoMinutes: string) => new Date(`2026-08-01T${isoMinutes}:00Z`);

  const event = (
    overrides: Partial<DeploymentEvent> & { at: Date },
  ): DeploymentEvent => ({
    buildId: "abc1234",
    environment: "prod",
    status: DeploymentStatus.DEPLOYED,
    changeAt: at("09:00"),
    intent: "promote",
    ...overrides,
  });

  it("should collapse one deployment's status entries into a single attempt", () => {
    // Given: a deploy that was dispatched, ran, and landed
    const events = [
      event({ at: at("10:00"), status: DeploymentStatus.DISPATCHING }),
      event({ at: at("10:01"), status: DeploymentStatus.DEPLOYING }),
      event({ at: at("10:06"), status: DeploymentStatus.DEPLOYED }),
    ];

    // When: reading it as history
    const attempts = toDeploymentAttempts(events);

    // Then: it is one line in the history, not three
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      buildId: "abc1234",
      environment: "prod",
      status: DeploymentStatus.DEPLOYED,
      startedAt: at("10:00"),
      finishedAt: at("10:06"),
      durationMs: 6 * 60 * 1000,
      intent: "promote",
    });
  });

  it("should keep a redeploy of the same build separate from the first try", () => {
    // Given: a build that failed, then was dispatched again and landed
    const events = [
      event({ at: at("10:00"), status: DeploymentStatus.DISPATCHING }),
      event({ at: at("10:03"), status: DeploymentStatus.ERROR }),
      event({ at: at("11:00"), status: DeploymentStatus.DISPATCHING }),
      event({ at: at("11:04"), status: DeploymentStatus.DEPLOYED }),
    ];

    // When: reading it as history
    const attempts = toDeploymentAttempts(events);

    // Then: both tries are on the record — the failure is not overwritten
    expect(attempts).toHaveLength(2);
    expect(attempts[0].status).toBe(DeploymentStatus.DEPLOYED);
    expect(attempts[1].status).toBe(DeploymentStatus.ERROR);
  });

  it("should list the most recent deployment first", () => {
    // Given: deploys to two environments at different times
    const events = [
      event({
        at: at("10:00"),
        environment: "staging",
        buildId: "old1111",
        status: DeploymentStatus.DEPLOYED,
      }),
      event({
        at: at("12:00"),
        environment: "prod",
        buildId: "new2222",
        status: DeploymentStatus.DEPLOYED,
      }),
    ];

    // When: reading it as history
    const attempts = toDeploymentAttempts(events);

    // Then: newest at the top, the way a log is read
    expect(attempts.map((a) => a.buildId)).toEqual(["new2222", "old1111"]);
  });

  it("should not confuse two environments deploying at the same time", () => {
    // Given: the same build going to staging and prod in parallel
    const events = [
      event({
        at: at("10:00"),
        environment: "staging",
        status: DeploymentStatus.DISPATCHING,
      }),
      event({
        at: at("10:00"),
        environment: "prod",
        status: DeploymentStatus.DISPATCHING,
      }),
      event({
        at: at("10:05"),
        environment: "prod",
        status: DeploymentStatus.ERROR,
      }),
      event({
        at: at("10:09"),
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      }),
    ];

    // When: reading it as history
    const attempts = toDeploymentAttempts(events);

    // Then: each environment keeps its own outcome
    expect(attempts).toHaveLength(2);
    const staging = attempts.find((a) => a.environment === "staging");
    const prod = attempts.find((a) => a.environment === "prod");
    expect(staging?.status).toBe(DeploymentStatus.DEPLOYED);
    expect(prod?.status).toBe(DeploymentStatus.ERROR);
  });

  it("should show a deployment still in flight as unfinished", () => {
    // Given: a deploy that has started but not resolved
    const events = [
      event({ at: at("10:00"), status: DeploymentStatus.DISPATCHING }),
      event({ at: at("10:01"), status: DeploymentStatus.DEPLOYING }),
    ];

    // When: reading it as history
    const attempts = toDeploymentAttempts(events);

    // Then: it has no end time and no duration — reporting one would be a guess
    expect(attempts[0].status).toBe(DeploymentStatus.DEPLOYING);
    expect(attempts[0].finishedAt).toBeNull();
    expect(attempts[0].durationMs).toBeNull();
  });

  it("should record a deployment that never announced itself as dispatched", () => {
    // Given: a reporter calling back about a deploy nobody dispatched here
    const events = [
      event({
        at: at("10:00"),
        status: DeploymentStatus.DEPLOYED,
        intent: undefined,
      }),
    ];

    // When: reading it as history
    const attempts = toDeploymentAttempts(events);

    // Then: it is still history — we just cannot say how long it took
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: DeploymentStatus.DEPLOYED,
      durationMs: null,
      intent: undefined,
    });
  });

  it("should carry the intent decided at dispatch through to the outcome", () => {
    // Given: a rollback, whose later status entries do not repeat the intent
    const events = [
      event({
        at: at("10:00"),
        status: DeploymentStatus.DISPATCHING,
        intent: "rollback",
      }),
      event({
        at: at("10:04"),
        status: DeploymentStatus.DEPLOYED,
        intent: undefined,
      }),
    ];

    // When: reading it as history
    const attempts = toDeploymentAttempts(events);

    // Then: the history says it was a rollback
    expect(attempts[0].intent).toBe("rollback");
  });

  it("should keep only the most recent deployments when asked for a limit", () => {
    // Given: more deployments than the page shows
    const events = [
      event({ at: at("10:00"), buildId: "one1111" }),
      event({ at: at("11:00"), buildId: "two2222" }),
      event({ at: at("12:00"), buildId: "three33" }),
    ];

    // When: reading a two-deep history
    const attempts = toDeploymentAttempts(events, { limit: 2 });

    // Then: the newest two, not the first two found
    expect(attempts.map((a) => a.buildId)).toEqual(["three33", "two2222"]);
  });
});
