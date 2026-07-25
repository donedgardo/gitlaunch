import { describe, it, expect } from "vitest";
import { compareVariants, requiredSamplePerVariant } from "./significance";

describe("significance", () => {
  describe("compareVariants", () => {
    it("should call a large, clearly better challenger a winner", () => {
      // Given a challenger converting far better over a large sample
      const baseline = {
        variant: "control",
        exposures: 5000,
        conversions: 250,
      };
      const challenger = {
        variant: "benefit-led",
        exposures: 5000,
        conversions: 400,
      };

      // When I compare them
      const result = compareVariants(baseline, challenger);

      // Then the challenger is reported as winning with high confidence
      expect(result.verdict).toBe("winning");
      expect(result.significant).toBe(true);
      expect(result.pValue).toBeLessThan(0.01);
      expect(result.relativeLift).toBeCloseTo(0.6, 2);
    });

    it("should call a large, clearly worse challenger a loser", () => {
      // Given a challenger converting far worse over a large sample
      const baseline = {
        variant: "control",
        exposures: 5000,
        conversions: 400,
      };
      const challenger = {
        variant: "benefit-led",
        exposures: 5000,
        conversions: 250,
      };

      // When I compare them
      const result = compareVariants(baseline, challenger);

      // Then the challenger is reported as losing
      expect(result.verdict).toBe("losing");
      expect(result.significant).toBe(true);
    });

    it("should stay inconclusive when the sample is too small to tell", () => {
      // Given the amount of traffic a young experiment actually has
      const baseline = { variant: "control", exposures: 23, conversions: 1 };
      const challenger = {
        variant: "benefit-led",
        exposures: 21,
        conversions: 1,
      };

      // When I compare them
      const result = compareVariants(baseline, challenger);

      // Then no winner is declared
      expect(result.verdict).toBe("inconclusive");
      expect(result.significant).toBe(false);
      expect(result.pValue).toBeGreaterThan(0.05);
    });

    it("should report insufficient data when a variant has no exposures", () => {
      // Given a variant nobody has been exposed to
      const baseline = { variant: "control", exposures: 0, conversions: 0 };
      const challenger = {
        variant: "benefit-led",
        exposures: 40,
        conversions: 4,
      };

      // When I compare them
      const result = compareVariants(baseline, challenger);

      // Then the comparison reports there is nothing to compare
      expect(result.verdict).toBe("insufficient-data");
      expect(result.significant).toBe(false);
      expect(result.pValue).toBeNull();
    });

    it("should report the observed rates and absolute lift", () => {
      // Given two measured variants
      const baseline = { variant: "control", exposures: 200, conversions: 20 };
      const challenger = {
        variant: "urgency",
        exposures: 100,
        conversions: 15,
      };

      // When I compare them
      const result = compareVariants(baseline, challenger);

      // Then the rates and the difference between them are reported
      expect(result.baselineRate).toBeCloseTo(0.1, 6);
      expect(result.variantRate).toBeCloseTo(0.15, 6);
      expect(result.absoluteLift).toBeCloseTo(0.05, 6);
      expect(result.relativeLift).toBeCloseTo(0.5, 6);
    });

    it("should leave relative lift undefined when the baseline never converts", () => {
      // Given a baseline with no conversions at all
      const baseline = { variant: "control", exposures: 100, conversions: 0 };
      const challenger = { variant: "urgency", exposures: 100, conversions: 5 };

      // When I compare them
      const result = compareVariants(baseline, challenger);

      // Then relative lift is not reportable, but absolute lift still is
      expect(result.relativeLift).toBeNull();
      expect(result.absoluteLift).toBeCloseTo(0.05, 6);
    });

    it("should name the variants being compared", () => {
      // Given two named variants
      const baseline = { variant: "control", exposures: 100, conversions: 10 };
      const challenger = {
        variant: "urgency",
        exposures: 100,
        conversions: 12,
      };

      // When I compare them
      const result = compareVariants(baseline, challenger);

      // Then the result says which is which
      expect(result.baseline).toBe("control");
      expect(result.variant).toBe("urgency");
    });
  });

  describe("requiredSamplePerVariant", () => {
    it("should size an experiment for the effect it wants to detect", () => {
      // Given a 10% baseline and a wish to detect a 5 point absolute lift
      // When I size the experiment
      const needed = requiredSamplePerVariant({
        baselineRate: 0.1,
        minimumDetectableEffect: 0.05,
      });

      // Then it asks for a realistic per-variant sample
      // (textbook two-proportion sizing lands around 600-700 per arm here)
      expect(needed).toBeGreaterThan(400);
      expect(needed).toBeLessThan(1200);
    });

    it("should demand a bigger sample to detect a smaller effect", () => {
      // Given the same baseline but a subtler effect to detect
      const forBigEffect = requiredSamplePerVariant({
        baselineRate: 0.1,
        minimumDetectableEffect: 0.05,
      });
      const forSmallEffect = requiredSamplePerVariant({
        baselineRate: 0.1,
        minimumDetectableEffect: 0.01,
      });

      // Then the subtler effect needs more traffic
      expect(forSmallEffect).toBeGreaterThan(forBigEffect);
    });
  });
});
