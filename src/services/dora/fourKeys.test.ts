import { describe, it, expect } from "vitest";
import { DeploymentStatus } from "../service/deploymentStatus";
import { computeFourKeys, DeploymentEvent } from "./fourKeys";

const HOUR = 60 * 60 * 1000;

const t = (iso: string) => new Date(iso);

const event = ({
  at,
  changeAt,
  ...rest
}: Omit<Partial<DeploymentEvent>, "at" | "changeAt"> & {
  at: string;
  changeAt?: Date;
}): DeploymentEvent => ({
  buildId: "b1",
  environment: "prod",
  status: DeploymentStatus.DEPLOYED,
  ...rest,
  at: t(at),
  changeAt: changeAt ?? t(at),
});

const window = {
  from: t("2026-08-01T00:00:00Z"),
  to: t("2026-08-11T00:00:00Z"), // 10 days
};

describe("fourKeys", () => {
  describe("deployment frequency", () => {
    it("should report deploys per day over the window", () => {
      // Given: 20 deploys land in a 10 day window
      const events = Array.from({ length: 20 }, (_, i) =>
        event({
          buildId: `b${i}`,
          at: new Date(window.from.getTime() + i * HOUR).toISOString(),
        }),
      );

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: two a day
      expect(keys.deploymentFrequencyPerDay).toBeCloseTo(2);
      expect(keys.sample.deployments).toBe(20);
    });

    it("should ignore deploys to other environments", () => {
      // Given: deploys to staging and prod
      const events = [
        event({ at: "2026-08-02T00:00:00Z", environment: "staging" }),
        event({ at: "2026-08-03T00:00:00Z", environment: "prod" }),
      ];

      // When: we measure prod
      const keys = computeFourKeys(events, "prod", window);

      // Then: only prod counts — the four keys are per environment, and
      // environments here are whatever the team named them
      expect(keys.sample.deployments).toBe(1);
    });

    it("should ignore deploys outside the window", () => {
      // Given: one deploy before the window and one inside it
      const events = [
        event({ at: "2026-07-01T00:00:00Z" }),
        event({ at: "2026-08-03T00:00:00Z" }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: only the one inside counts
      expect(keys.sample.deployments).toBe(1);
    });
  });

  describe("lead time for changes", () => {
    it("should measure from when the change was made to when it went live", () => {
      // Given: a change authored 2h before it landed, and one 4h before
      const events = [
        event({
          buildId: "fast",
          at: "2026-08-02T12:00:00Z",
          changeAt: t("2026-08-02T10:00:00Z"),
        }),
        event({
          buildId: "slow",
          at: "2026-08-03T12:00:00Z",
          changeAt: t("2026-08-03T08:00:00Z"),
        }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: the median of 2h and 4h
      expect(keys.medianLeadTimeMs).toBe(3 * HOUR);
      expect(keys.sample.leadTimes).toBe(2);
    });

    it("should not count a rollback as a fast change", () => {
      // Given: a rollback puts a week-old build live again
      const events = [
        event({
          buildId: "new",
          at: "2026-08-05T12:00:00Z",
          changeAt: t("2026-08-05T10:00:00Z"),
        }),
        event({
          buildId: "old",
          at: "2026-08-05T13:00:00Z",
          changeAt: t("2026-07-29T10:00:00Z"),
          intent: "rollback",
        }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: only the real change counts — a rollback is not a change being
      // delivered, and counting it would make lead time look terrible
      expect(keys.sample.leadTimes).toBe(1);
      expect(keys.medianLeadTimeMs).toBe(2 * HOUR);
    });

    it("should report no lead time when nothing shipped", () => {
      const keys = computeFourKeys([], "prod", window);
      expect(keys.medianLeadTimeMs).toBeNull();
    });

    it("should ignore a change that appears to have shipped before it was made", () => {
      // Given: one honest change, and one whose reported commit time is an
      // hour *after* it went live — a CI runner with a skewed clock, or a
      // reporter sending the wrong field
      const events = [
        event({
          buildId: "honest",
          at: "2026-08-02T12:00:00Z",
          changeAt: t("2026-08-02T10:00:00Z"),
        }),
        event({
          buildId: "skewed",
          at: "2026-08-03T12:00:00Z",
          changeAt: t("2026-08-03T13:00:00Z"),
        }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: only the honest one is a lead-time sample. A negative lead time
      // is not a fast delivery, and averaging it in would quietly flatter the
      // number for every team whose clocks disagree.
      expect(keys.sample.leadTimes).toBe(1);
      expect(keys.medianLeadTimeMs).toBe(2 * HOUR);

      // And it still counts as a deployment — the deploy really happened
      expect(keys.sample.deployments).toBe(2);
    });
  });

  describe("change failure rate", () => {
    it("should count a deploy that had to be rolled back as a failure", () => {
      // Given: three deploys, the second of which was rolled back
      const events = [
        event({ buildId: "ok1", at: "2026-08-02T00:00:00Z" }),
        event({ buildId: "bad", at: "2026-08-03T00:00:00Z" }),
        event({
          buildId: "ok1",
          at: "2026-08-03T01:00:00Z",
          intent: "rollback",
        }),
        event({ buildId: "ok2", at: "2026-08-04T00:00:00Z" }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: 1 of the 3 real changes failed — the rollback itself is not a
      // change, so it is not in the denominator
      expect(keys.sample.deployments).toBe(4);
      expect(keys.sample.failures).toBe(1);
      expect(keys.changeFailureRate).toBeCloseTo(1 / 3);
    });

    it("should count a deploy that errored as a failure", () => {
      // Given: one clean deploy and one that failed on the way out
      const events = [
        event({ buildId: "ok", at: "2026-08-02T00:00:00Z" }),
        event({
          buildId: "broken",
          at: "2026-08-03T00:00:00Z",
          status: DeploymentStatus.ERROR,
        }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: half the changes failed
      expect(keys.changeFailureRate).toBeCloseTo(0.5);
      expect(keys.sample.failures).toBe(1);
    });

    it("should not count a cancelled deploy as a failure", () => {
      // Given: a deploy someone cancelled before it went anywhere
      const events = [
        event({ buildId: "ok", at: "2026-08-02T00:00:00Z" }),
        event({
          buildId: "stopped",
          at: "2026-08-03T00:00:00Z",
          status: DeploymentStatus.CANCELLED,
        }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: nothing broke — a change that never shipped is not a failure
      expect(keys.changeFailureRate).toBe(0);
      expect(keys.sample.deployments).toBe(1);
    });

    it("should report no rate when nothing was deployed", () => {
      const keys = computeFourKeys([], "prod", window);
      expect(keys.changeFailureRate).toBeNull();
    });
  });

  describe("time to restore", () => {
    it("should measure from the bad deploy to the rollback that fixed it", () => {
      // Given: a deploy broke prod and was rolled back 3h later
      const events = [
        event({ buildId: "good", at: "2026-08-02T00:00:00Z" }),
        event({ buildId: "bad", at: "2026-08-03T00:00:00Z" }),
        event({
          buildId: "good",
          at: "2026-08-03T03:00:00Z",
          intent: "rollback",
        }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: 3 hours to restore
      expect(keys.medianTimeToRestoreMs).toBe(3 * HOUR);
      expect(keys.sample.restores).toBe(1);
    });

    it("should measure a roll-forward fix as a restore too", () => {
      // Given: a deploy errored and the team fixed forward 2h later rather
      // than rolling back
      const events = [
        event({
          buildId: "bad",
          at: "2026-08-03T00:00:00Z",
          status: DeploymentStatus.ERROR,
        }),
        event({ buildId: "fix", at: "2026-08-03T02:00:00Z" }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: recovery is recovery, whichever direction the team went
      expect(keys.medianTimeToRestoreMs).toBe(2 * HOUR);
      expect(keys.sample.restores).toBe(1);
    });

    it("should not count a failure that was never recovered", () => {
      // Given: a deploy broke and nothing has landed since
      const events = [
        event({
          buildId: "bad",
          at: "2026-08-03T00:00:00Z",
          status: DeploymentStatus.ERROR,
        }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: an unfinished outage has no restore time — it must not be
      // silently reported as zero
      expect(keys.medianTimeToRestoreMs).toBeNull();
      expect(keys.sample.restores).toBe(0);
    });

    it("should take the median across several incidents", () => {
      // Given: three incidents recovered in 1h, 2h and 6h
      const events = [
        event({ buildId: "a", at: "2026-08-02T00:00:00Z" }),
        event({ buildId: "bad1", at: "2026-08-02T01:00:00Z" }),
        event({
          buildId: "a",
          at: "2026-08-02T02:00:00Z",
          intent: "rollback",
        }),
        event({ buildId: "bad2", at: "2026-08-03T01:00:00Z" }),
        event({
          buildId: "a",
          at: "2026-08-03T03:00:00Z",
          intent: "rollback",
        }),
        event({ buildId: "bad3", at: "2026-08-04T01:00:00Z" }),
        event({
          buildId: "a",
          at: "2026-08-04T07:00:00Z",
          intent: "rollback",
        }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: the median incident, not the mean — one bad night should not
      // define the number
      expect(keys.sample.restores).toBe(3);
      expect(keys.medianTimeToRestoreMs).toBe(2 * HOUR);
    });
  });

  describe("the whole picture", () => {
    it("should report every key from one pass of the event log", () => {
      // Given: a fortnight of ordinary delivery with one bad deploy
      const events = [
        event({
          buildId: "v1",
          at: "2026-08-02T12:00:00Z",
          changeAt: t("2026-08-02T11:00:00Z"),
        }),
        event({
          buildId: "v2",
          at: "2026-08-04T12:00:00Z",
          changeAt: t("2026-08-04T09:00:00Z"),
        }),
        event({
          buildId: "v1",
          at: "2026-08-04T13:00:00Z",
          changeAt: t("2026-08-02T11:00:00Z"),
          intent: "rollback",
        }),
        event({
          buildId: "v3",
          at: "2026-08-06T12:00:00Z",
          changeAt: t("2026-08-06T10:00:00Z"),
        }),
      ];

      // When: we measure
      const keys = computeFourKeys(events, "prod", window);

      // Then: all four keys come off the same log, with the sample sizes that
      // produced them
      expect(keys.deploymentFrequencyPerDay).toBeCloseTo(4 / 10);
      expect(keys.medianLeadTimeMs).toBe(2 * HOUR);
      expect(keys.changeFailureRate).toBeCloseTo(1 / 3);
      expect(keys.medianTimeToRestoreMs).toBe(1 * HOUR);
      expect(keys.sample).toEqual({
        deployments: 4,
        failures: 1,
        restores: 1,
        leadTimes: 3,
      });
    });

    it("should report an empty window without dividing by zero", () => {
      const keys = computeFourKeys([], "prod", {
        from: window.from,
        to: window.from,
      });
      expect(keys.deploymentFrequencyPerDay).toBe(0);
      expect(Number.isFinite(keys.deploymentFrequencyPerDay)).toBe(true);
    });
  });
});
