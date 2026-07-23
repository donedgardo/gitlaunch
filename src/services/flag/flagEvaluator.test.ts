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

  describe("targeting rules", () => {
    it("should serve a matched rule's variant regardless of the rollout gate", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 0, // nobody would be in the rollout...
        variants: [{ key: "treatment", weight: 100 }],
        targetingRules: [
          {
            conditions: [
              { attribute: "country", operator: "in", values: ["US", "CA"] },
            ],
            serve: "treatment",
          },
        ],
      };

      const result = evaluateFlag(cfg, "new-checkout", "user-1", {
        country: "US",
      });

      expect(result.enabled).toBe(true);
      expect(result.variant).toBe("treatment");
      expect(result.reason).toBe("targeting_rule");
    });

    it("should fall through to rollout when no rule matches", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 100,
        variants: [],
        targetingRules: [
          {
            conditions: [
              { attribute: "country", operator: "eq", values: ["US"] },
            ],
            serve: null,
          },
        ],
      };

      const result = evaluateFlag(cfg, "new-checkout", "user-1", {
        country: "DE",
      });

      expect(result.enabled).toBe(true);
      expect(result.reason).toBe("rollout");
    });

    it("should require all conditions in a rule to match (AND)", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 0,
        variants: [],
        targetingRules: [
          {
            conditions: [
              { attribute: "country", operator: "eq", values: ["US"] },
              { attribute: "plan", operator: "eq", values: ["pro"] },
            ],
            serve: null,
          },
        ],
      };

      // Only one of the two conditions holds → rule does not match.
      const partial = evaluateFlag(cfg, "f", "u", {
        country: "US",
        plan: "free",
      });
      expect(partial.reason).toBe("not_in_rollout");

      // Both conditions hold → rule matches.
      const full = evaluateFlag(cfg, "f", "u", { country: "US", plan: "pro" });
      expect(full.enabled).toBe(true);
      expect(full.reason).toBe("targeting_rule");
    });

    it("should use the first matching rule when several match (OR / order)", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 100,
        variants: [
          { key: "beta", weight: 50 },
          { key: "vip", weight: 50 },
        ],
        targetingRules: [
          {
            conditions: [
              { attribute: "plan", operator: "eq", values: ["enterprise"] },
            ],
            serve: "vip",
          },
          {
            conditions: [
              { attribute: "beta", operator: "eq", values: ["true"] },
            ],
            serve: "beta",
          },
        ],
      };

      const result = evaluateFlag(cfg, "f", "u", {
        plan: "enterprise",
        beta: true,
      });
      expect(result.variant).toBe("vip");
    });

    it("should not match when the targeted attribute is absent", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 0,
        variants: [],
        targetingRules: [
          {
            conditions: [
              { attribute: "country", operator: "not_in", values: ["US"] },
            ],
            serve: null,
          },
        ],
      };

      // No country attribute supplied → rule does not apply (safe default).
      const result = evaluateFlag(cfg, "f", "u", {});
      expect(result.reason).toBe("not_in_rollout");
    });

    it("should support neq, not_in and contains operators", () => {
      const rule = (
        attribute: string,
        operator: "neq" | "not_in" | "contains",
        values: string[],
      ): FlagEnvironmentConfig => ({
        enabled: true,
        rolloutPercentage: 0,
        variants: [],
        targetingRules: [
          { conditions: [{ attribute, operator, values }], serve: null },
        ],
      });

      expect(
        evaluateFlag(rule("plan", "neq", ["free"]), "f", "u", { plan: "pro" })
          .reason,
      ).toBe("targeting_rule");
      expect(
        evaluateFlag(rule("plan", "not_in", ["free", "trial"]), "f", "u", {
          plan: "pro",
        }).reason,
      ).toBe("targeting_rule");
      expect(
        evaluateFlag(rule("email", "contains", ["@acme.com"]), "f", "u", {
          email: "jane@acme.com",
        }).reason,
      ).toBe("targeting_rule");
    });

    it("should be a no-op when there are no targeting rules", () => {
      const cfg: FlagEnvironmentConfig = {
        enabled: true,
        rolloutPercentage: 100,
        variants: [],
        targetingRules: [],
      };

      const result = evaluateFlag(cfg, "f", "u", { country: "US" });
      expect(result.reason).toBe("rollout");
    });
  });
});
