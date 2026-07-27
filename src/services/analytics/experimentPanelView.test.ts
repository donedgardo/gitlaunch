import { describe, it, expect } from "vitest";
import { toExperimentPanelView } from "./experimentPanelView";

type Arm = { variant: string; exposures: number; conversions: number };

// Builds the shape ExperimentResultsService returns, so the view is exercised
// through the same contract the flags page feeds it.
function results(variants: Arm[]) {
  const withRates = variants.map((v) => ({
    ...v,
    conversionRate: v.exposures > 0 ? v.conversions / v.exposures : 0,
  }));
  const exposures = withRates.reduce((s, v) => s + v.exposures, 0);
  const conversions = withRates.reduce((s, v) => s + v.conversions, 0);
  return {
    flagKey: "hero-copy",
    environment: "prod",
    variants: withRates,
    totals: {
      exposures,
      conversions,
      conversionRate: exposures > 0 ? conversions / exposures : 0,
    },
  };
}

describe("toExperimentPanelView", () => {
  describe("decision", () => {
    it("should tell the customer the experiment is too young to call when no arm has separated", () => {
      // Given two arms with a small, statistically indistinguishable gap
      const view = toExperimentPanelView(
        results([
          { variant: "control", exposures: 100, conversions: 5 },
          { variant: "benefit-led", exposures: 100, conversions: 7 },
        ]),
      );

      // Then the panel says to keep running and quotes the traffic still needed
      expect(view.decision?.label).toBe("Keep running");
      expect(view.decision?.tone).toBe("running");
      expect(view.decision?.detail).toContain("more per arm");
    });

    it("should name the winner to ship when a challenger beats the baseline significantly", () => {
      // Given a challenger converting four times better over a real sample
      const view = toExperimentPanelView(
        results([
          { variant: "control", exposures: 200, conversions: 10 },
          { variant: "benefit-led", exposures: 200, conversions: 40 },
        ]),
      );

      // Then the panel recommends shipping it, with the confidence behind it
      expect(view.decision?.label).toBe("Ship benefit-led");
      expect(view.decision?.tone).toBe("ship");
      expect(view.decision?.detail).toContain("confidence");
    });

    it("should recommend keeping the baseline when every challenger loses significantly", () => {
      const view = toExperimentPanelView(
        results([
          { variant: "control", exposures: 200, conversions: 40 },
          { variant: "benefit-led", exposures: 200, conversions: 10 },
        ]),
      );

      expect(view.decision?.label).toBe("Keep control");
      expect(view.decision?.tone).toBe("control");
    });

    it("should say there is nothing to compare when only one arm got traffic", () => {
      const view = toExperimentPanelView(
        results([{ variant: "control", exposures: 100, conversions: 5 }]),
      );

      expect(view.decision?.label).toBe("Nothing to compare");
      expect(view.decision?.tone).toBe("none");
    });

    it("should omit the decision entirely when the experiment has no data", () => {
      const view = toExperimentPanelView(results([]));

      expect(view.hasData).toBe(false);
      expect(view.decision).toBeUndefined();
    });
  });

  describe("variant rows", () => {
    it("should mark the baseline arm and give it no lift to report against itself", () => {
      const view = toExperimentPanelView(
        results([
          { variant: "control", exposures: 200, conversions: 10 },
          { variant: "benefit-led", exposures: 200, conversions: 40 },
        ]),
      );

      const baseline = view.variants.find((v) => v.variant === "control");
      expect(baseline?.isBaseline).toBe(true);
      expect(baseline?.liftPct).toBeUndefined();
    });

    it("should report each challenger's lift and confidence against the baseline", () => {
      const view = toExperimentPanelView(
        results([
          { variant: "control", exposures: 200, conversions: 10 },
          { variant: "benefit-led", exposures: 200, conversions: 40 },
        ]),
      );

      const challenger = view.variants.find((v) => v.variant === "benefit-led");
      expect(challenger?.isBaseline).toBe(false);
      // 5% -> 20% is a 300% relative lift, signed so the direction is obvious.
      expect(challenger?.liftPct).toBe("+300.0");
      expect(challenger?.significant).toBe(true);
      expect(challenger?.confidencePct).toBeDefined();
    });

    it("should flag a challenger as not significant while the result is still noise", () => {
      const view = toExperimentPanelView(
        results([
          { variant: "control", exposures: 100, conversions: 5 },
          { variant: "benefit-led", exposures: 100, conversions: 7 },
        ]),
      );

      const challenger = view.variants.find((v) => v.variant === "benefit-led");
      expect(challenger?.significant).toBe(false);
      expect(challenger?.liftPct).toBe("+40.0");
    });

    it("should keep the counts and bar widths the panel already showed", () => {
      const view = toExperimentPanelView(
        results([
          { variant: "control", exposures: 200, conversions: 10 },
          { variant: "benefit-led", exposures: 200, conversions: 40 },
        ]),
      );

      const challenger = view.variants.find((v) => v.variant === "benefit-led");
      expect(challenger?.conversionRatePct).toBe("20.0");
      expect(challenger?.barPct).toBe(100);
      expect(view.totals.conversionRatePct).toBe("12.5");
    });
  });
});
