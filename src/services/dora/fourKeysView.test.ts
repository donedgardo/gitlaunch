import { describe, it, expect } from "vitest";
import { FourKeys } from "./fourKeys";
import { toFourKeysView } from "./fourKeysView";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const keys = (overrides: Partial<FourKeys> = {}): FourKeys => ({
  deploymentFrequencyPerDay: 0,
  medianLeadTimeMs: null,
  changeFailureRate: null,
  medianTimeToRestoreMs: null,
  sample: { deployments: 0, failures: 0, restores: 0, leadTimes: 0 },
  ...overrides,
});

describe("toFourKeysView", () => {
  describe("an environment with a real delivery history", () => {
    it("should read the four keys back in human units", () => {
      // Given: a fortnight of steady delivery
      const view = toFourKeysView(
        keys({
          deploymentFrequencyPerDay: 3.25,
          medianLeadTimeMs: 2 * HOUR + 15 * MINUTE,
          changeFailureRate: 0.125,
          medianTimeToRestoreMs: 45 * MINUTE,
          sample: {
            deployments: 40,
            failures: 5,
            restores: 5,
            leadTimes: 40,
          },
        }),
      );

      // Then: every number is readable without doing arithmetic
      expect(view.deploymentFrequency).toBe("3.3/day");
      expect(view.leadTime).toBe("2h 15m");
      expect(view.changeFailureRate).toBe("13%");
      expect(view.timeToRestore).toBe("45m");
    });

    it("should not warn about confidence once enough has shipped", () => {
      // Given: plenty of deploys behind the numbers
      const view = toFourKeysView(
        keys({
          deploymentFrequencyPerDay: 1,
          changeFailureRate: 0.1,
          sample: { deployments: 10, failures: 1, restores: 1, leadTimes: 10 },
        }),
      );

      // Then: the numbers stand on their own
      expect(view.lowConfidence).toBe(false);
    });
  });

  describe("an environment with nothing to report", () => {
    it("should say nothing rather than report zeroes", () => {
      // Given: a service that has never deployed here
      const view = toFourKeysView(keys());

      // Then: a blank, not "0h lead time" and "0% failure rate", which read
      // as perfect scores
      expect(view.hasData).toBe(false);
      expect(view.leadTime).toBe("—");
      expect(view.changeFailureRate).toBe("—");
      expect(view.timeToRestore).toBe("—");
    });

    it("should still report a metric that has no samples yet", () => {
      // Given: deploys that have all succeeded, so nothing has been restored
      const view = toFourKeysView(
        keys({
          deploymentFrequencyPerDay: 2,
          medianLeadTimeMs: 1 * HOUR,
          changeFailureRate: 0,
          medianTimeToRestoreMs: null,
          sample: { deployments: 20, failures: 0, restores: 0, leadTimes: 20 },
        }),
      );

      // Then: never having broken is a 0% failure rate, but "time to
      // restore" has genuinely never been measured
      expect(view.hasData).toBe(true);
      expect(view.changeFailureRate).toBe("0%");
      expect(view.timeToRestore).toBe("—");
    });
  });

  describe("confidence", () => {
    it("should warn when the numbers rest on a handful of deploys", () => {
      // Given: one bad deploy out of three
      const view = toFourKeysView(
        keys({
          deploymentFrequencyPerDay: 0.3,
          changeFailureRate: 1 / 3,
          sample: { deployments: 3, failures: 1, restores: 1, leadTimes: 3 },
        }),
      );

      // Then: "33% change failure rate" off three deploys is noise, and the
      // panel has to be able to say so
      expect(view.lowConfidence).toBe(true);
      expect(view.changeFailureRate).toBe("33%");
      expect(view.sample.deployments).toBe(3);
    });
  });

  describe("durations", () => {
    it("should drop to minutes for something that shipped fast", () => {
      const view = toFourKeysView(
        keys({
          medianLeadTimeMs: 8 * MINUTE,
          sample: { deployments: 1, failures: 0, restores: 0, leadTimes: 1 },
        }),
      );
      expect(view.leadTime).toBe("8m");
    });

    it("should round to whole hours when the minutes add nothing", () => {
      const view = toFourKeysView(
        keys({
          medianLeadTimeMs: 3 * HOUR,
          sample: { deployments: 1, failures: 0, restores: 0, leadTimes: 1 },
        }),
      );
      expect(view.leadTime).toBe("3h");
    });

    it("should switch to days once an hour count stops being readable", () => {
      const view = toFourKeysView(
        keys({
          medianLeadTimeMs: 3 * DAY + 4 * HOUR,
          sample: { deployments: 1, failures: 0, restores: 0, leadTimes: 1 },
        }),
      );
      expect(view.leadTime).toBe("3d 4h");
    });

    it("should report anything under a minute as under a minute", () => {
      const view = toFourKeysView(
        keys({
          medianLeadTimeMs: 20 * 1000,
          sample: { deployments: 1, failures: 0, restores: 0, leadTimes: 1 },
        }),
      );
      expect(view.leadTime).toBe("<1m");
    });
  });

  describe("deployment frequency", () => {
    it("should count per week when a team does not ship daily", () => {
      // Given: about three deploys a week
      const view = toFourKeysView(
        keys({
          deploymentFrequencyPerDay: 0.43,
          sample: { deployments: 6, failures: 0, restores: 0, leadTimes: 6 },
        }),
      );

      // Then: "0.4/day" is harder to read than the same fact per week
      expect(view.deploymentFrequency).toBe("3.0/wk");
    });

    it("should count per month for infrequent delivery", () => {
      // Given: roughly two deploys a month
      const view = toFourKeysView(
        keys({
          deploymentFrequencyPerDay: 0.066,
          sample: { deployments: 2, failures: 0, restores: 0, leadTimes: 2 },
        }),
      );

      expect(view.deploymentFrequency).toBe("2.0/mo");
    });

    it("should report no deployments as a blank", () => {
      const view = toFourKeysView(keys());
      expect(view.deploymentFrequency).toBe("—");
    });
  });
});
