import { describe, it, expect } from "vitest";
import { evaluateFlagLocally } from "./localEvaluator";
import type { FlagEnvironmentConfig } from "./localEvaluator";
import goldenVectors from "../../src/services/flag/evaluation.golden.json";

// This vendors the same evaluation logic as
// src/services/flag/flagEvaluator.ts (the SDK ships to customers and can't
// depend on server-only code). Running both suites against one shared fixture
// is what stops the two copies from silently desyncing — see
// flagEvaluator.test.ts's matching "golden vectors" block.
describe("evaluateFlagLocally", () => {
  for (const vector of goldenVectors) {
    it(vector.name, async () => {
      const result = await evaluateFlagLocally(
        vector.cfg as FlagEnvironmentConfig,
        vector.key,
        vector.entityKey,
        vector.attributes,
      );
      expect(result).toEqual(vector.expected);
    });
  }
});
