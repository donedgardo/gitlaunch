import { describe, it, expect } from "vitest";
import { evaluateFlag } from "./flagEvaluator";
import type { FlagEnvironmentConfig } from "../../repositories/flagRepository";

const off: FlagEnvironmentConfig = {
  enabled: false,
  rolloutPercentage: 100,
  variants: [],
};

describe("flagEvaluator", () => {
  describe("evaluateFlag", () => {
    it("should report disabled when the environment config is off", () => {
      const result = evaluateFlag(off, "new-checkout", "user-1");

      expect(result).toEqual({
        key: "new-checkout",
        enabled: false,
        variant: null,
        reason: "disabled",
      });
    });

    it("should enable everyone at 100% rollout with no variants", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 100,
        variants: [],
      };

      const result = evaluateFlag(cfg, "new-checkout", "user-42");

      expect(result.enabled).toBe(true);
      expect(result.variant).toBeNull();
      expect(result.reason).toBe("rollout");
    });

    it("should enable nobody at 0% rollout", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 0,
        variants: [],
      };

      for (let i = 0; i < 200; i++) {
        const result = evaluateFlag(cfg, "new-checkout", `user-${i}`);
        expect(result.enabled).toBe(false);
        expect(result.reason).toBe("not_in_rollout");
      }
    });

    it("should be deterministic for the same flag and entity", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 50,
        variants: [],
      };

      const first = evaluateFlag(cfg, "new-checkout", "stable-entity");
      for (let i = 0; i < 25; i++) {
        expect(evaluateFlag(cfg, "new-checkout", "stable-entity")).toEqual(
          first,
        );
      }
    });

    it("should roll out to approximately the target percentage across entities", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 30,
        variants: [],
      };

      let enabledCount = 0;
      const total = 10000;
      for (let i = 0; i < total; i++) {
        if (evaluateFlag(cfg, "new-checkout", `user-${i}`).enabled) {
          enabledCount++;
        }
      }

      const ratio = enabledCount / total;
      // Target 0.30, allow generous tolerance for hash distribution
      expect(ratio).toBeGreaterThan(0.27);
      expect(ratio).toBeLessThan(0.33);
    });

    it("should assign a single 100%-weight variant to everyone rolled in", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 100,
        variants: [{ key: "treatment", weight: 100 }],
      };

      for (let i = 0; i < 100; i++) {
        const result = evaluateFlag(cfg, "exp", `user-${i}`);
        expect(result.enabled).toBe(true);
        expect(result.variant).toBe("treatment");
        expect(result.reason).toBe("variant");
      }
    });

    it("should split variants approximately by weight", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 100,
        variants: [
          { key: "control", weight: 50 },
          { key: "treatment", weight: 50 },
        ],
      };

      const counts: Record<string, number> = { control: 0, treatment: 0 };
      const total = 10000;
      for (let i = 0; i < total; i++) {
        const result = evaluateFlag(cfg, "exp", `user-${i}`);
        expect(result.variant).not.toBeNull();
        counts[result.variant as string]++;
      }

      expect(counts.control / total).toBeGreaterThan(0.47);
      expect(counts.control / total).toBeLessThan(0.53);
      expect(counts.control + counts.treatment).toBe(total);
    });

    it("should assign the same variant to the same entity every time", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 100,
        variants: [
          { key: "a", weight: 33 },
          { key: "b", weight: 33 },
          { key: "c", weight: 34 },
        ],
      };

      const first = evaluateFlag(cfg, "exp", "sticky-user");
      for (let i = 0; i < 25; i++) {
        expect(evaluateFlag(cfg, "exp", "sticky-user").variant).toBe(
          first.variant,
        );
      }
    });
  });
});
