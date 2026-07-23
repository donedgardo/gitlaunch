import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildConfigBundle, hashConfigBundle } from "./configBundle";
import {
  Flag,
  FlagEnvironmentConfig,
  defaultEnvironmentConfig,
} from "../../repositories/flagRepository";

describe("configBundle", () => {
  function makeFlag(
    key: string,
    environments: Record<string, FlagEnvironmentConfig>,
    description = "",
  ): Flag {
    const now = new Date();
    return {
      _id: new ObjectId(),
      accountId: new ObjectId(),
      serviceId: new ObjectId(),
      key,
      description,
      environments,
      createdAt: now,
      updatedAt: now,
    };
  }

  const on: FlagEnvironmentConfig = {
    enabled: true,
    rolloutPercentage: 100,
    variants: [],
  };
  const off: FlagEnvironmentConfig = {
    enabled: false,
    rolloutPercentage: 0,
    variants: [],
  };

  describe("buildConfigBundle", () => {
    it("should include one entry per flag using that environment's config", () => {
      const flags = [
        makeFlag("alpha", { prod: on, staging: off }),
        makeFlag("beta", { prod: off, staging: on }),
      ];

      const bundle = buildConfigBundle(flags, "prod");

      expect(bundle.environment).toBe("prod");
      expect(bundle.flags).toEqual([
        { key: "alpha", config: on },
        { key: "beta", config: off },
      ]);
    });

    it("should fall back to a safe-off config when a flag has no config for the environment", () => {
      const flags = [makeFlag("alpha", { prod: on })];

      const bundle = buildConfigBundle(flags, "staging");

      expect(bundle.flags).toEqual([
        {
          key: "alpha",
          config: defaultEnvironmentConfig(),
        },
      ]);
    });

    it("should order entries by flag key regardless of input order", () => {
      const bundle = buildConfigBundle(
        [makeFlag("zulu", { prod: on }), makeFlag("alpha", { prod: off })],
        "prod",
      );

      expect(bundle.flags.map((f) => f.key)).toEqual(["alpha", "zulu"]);
    });
  });

  describe("hashConfigBundle", () => {
    it("should produce the same hash for the same effective config regardless of flag input order", () => {
      const a = buildConfigBundle(
        [makeFlag("alpha", { prod: on }), makeFlag("beta", { prod: off })],
        "prod",
      );
      const b = buildConfigBundle(
        [makeFlag("beta", { prod: off }), makeFlag("alpha", { prod: on })],
        "prod",
      );

      expect(hashConfigBundle(a)).toBe(hashConfigBundle(b));
    });

    it("should change the hash when a rollout percentage changes", () => {
      const before = buildConfigBundle(
        [makeFlag("alpha", { prod: on })],
        "prod",
      );
      const after = buildConfigBundle(
        [makeFlag("alpha", { prod: { ...on, rolloutPercentage: 50 } })],
        "prod",
      );

      expect(hashConfigBundle(after)).not.toBe(hashConfigBundle(before));
    });

    it("should change the hash when a targeting rule changes", () => {
      const before = buildConfigBundle(
        [makeFlag("alpha", { prod: on })],
        "prod",
      );
      const after = buildConfigBundle(
        [
          makeFlag("alpha", {
            prod: {
              ...on,
              targetingRules: [
                {
                  conditions: [
                    { attribute: "country", operator: "eq", values: ["US"] },
                  ],
                  serve: null,
                },
              ],
            },
          }),
        ],
        "prod",
      );

      expect(hashConfigBundle(after)).not.toBe(hashConfigBundle(before));
    });

    it("should not change the hash when only a flag's description changes", () => {
      const before = buildConfigBundle(
        [makeFlag("alpha", { prod: on }, "old copy")],
        "prod",
      );
      const after = buildConfigBundle(
        [makeFlag("alpha", { prod: on }, "new copy")],
        "prod",
      );

      expect(hashConfigBundle(after)).toBe(hashConfigBundle(before));
    });

    it("should differ between environments with different config", () => {
      const flags = [makeFlag("alpha", { prod: on, staging: off })];

      expect(hashConfigBundle(buildConfigBundle(flags, "prod"))).not.toBe(
        hashConfigBundle(buildConfigBundle(flags, "staging")),
      );
    });
  });
});
