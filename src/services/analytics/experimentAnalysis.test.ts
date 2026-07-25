import { describe, it, expect } from "vitest";
import { analyzeExperiment } from "./experimentAnalysis";

const results = (
  variants: Array<{ variant: string; exposures: number; conversions: number }>,
) => ({
  flagKey: "waitlist-hero-copy",
  environment: "prod",
  variants: variants.map((v) => ({
    ...v,
    conversionRate: v.exposures > 0 ? v.conversions / v.exposures : 0,
  })),
  totals: {
    exposures: variants.reduce((s, v) => s + v.exposures, 0),
    conversions: variants.reduce((s, v) => s + v.conversions, 0),
    conversionRate: 0,
  },
});

describe("analyzeExperiment", () => {
  it("should measure every challenger against the control arm", () => {
    // Given an experiment with a control and two challengers
    const experiment = results([
      { variant: "benefit-led", exposures: 1000, conversions: 100 },
      { variant: "control", exposures: 1000, conversions: 50 },
      { variant: "urgency", exposures: 1000, conversions: 60 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then control is the baseline and each challenger is compared to it
    expect(analysis.baseline).toBe("control");
    expect(analysis.comparisons.map((c) => c.variant)).toEqual([
      "benefit-led",
      "urgency",
    ]);
  });

  it("should fall back to the most-exposed arm when nothing is named control", () => {
    // Given an experiment with no arm called "control"
    const experiment = results([
      { variant: "b", exposures: 100, conversions: 10 },
      { variant: "a", exposures: 900, conversions: 90 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then the arm carrying the most traffic is used as the baseline
    expect(analysis.baseline).toBe("a");
  });

  it("should recommend shipping a challenger that wins significantly", () => {
    // Given a challenger that clearly beats control
    const experiment = results([
      { variant: "control", exposures: 5000, conversions: 250 },
      { variant: "benefit-led", exposures: 5000, conversions: 400 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then it says to ship the winner and names it
    expect(analysis.recommendation).toBe("ship");
    expect(analysis.winner).toBe("benefit-led");
  });

  it("should recommend keeping the control when every challenger loses", () => {
    // Given a challenger that clearly does worse
    const experiment = results([
      { variant: "control", exposures: 5000, conversions: 400 },
      { variant: "benefit-led", exposures: 5000, conversions: 250 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then it says to keep control and names no winner
    expect(analysis.recommendation).toBe("keep-control");
    expect(analysis.winner).toBeNull();
  });

  it("should say to keep running when the sample is still too small", () => {
    // Given the traffic a young experiment actually has
    const experiment = results([
      { variant: "control", exposures: 23, conversions: 1 },
      { variant: "benefit-led", exposures: 21, conversions: 1 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then it says to keep running rather than calling a winner
    expect(analysis.recommendation).toBe("keep-running");
    expect(analysis.winner).toBeNull();
  });

  it("should say how much more traffic an undecided experiment needs", () => {
    // Given an undecided experiment
    const experiment = results([
      { variant: "control", exposures: 23, conversions: 1 },
      { variant: "benefit-led", exposures: 21, conversions: 1 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then it reports the per-arm sample needed and how far short it is
    expect(analysis.requiredSamplePerVariant).toBeGreaterThan(21);
    expect(analysis.shortfallPerVariant).toBe(
      analysis.requiredSamplePerVariant - 21,
    );
  });

  it("should not ask for more traffic once a decision is reached", () => {
    // Given a decided experiment
    const experiment = results([
      { variant: "control", exposures: 5000, conversions: 250 },
      { variant: "benefit-led", exposures: 5000, conversions: 400 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then there is no outstanding shortfall
    expect(analysis.shortfallPerVariant).toBe(0);
  });

  it("should report a single-arm experiment as having nothing to compare", () => {
    // Given an experiment where only one arm ever got traffic
    const experiment = results([
      { variant: "control", exposures: 40, conversions: 4 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then there is nothing to compare and no recommendation to ship
    expect(analysis.comparisons).toEqual([]);
    expect(analysis.recommendation).toBe("no-comparison");
  });

  it("should carry through which experiment was analysed", () => {
    // Given any experiment
    const experiment = results([
      { variant: "control", exposures: 10, conversions: 1 },
      { variant: "b", exposures: 10, conversions: 1 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then the flag and environment travel with the analysis
    expect(analysis.flagKey).toBe("waitlist-hero-copy");
    expect(analysis.environment).toBe("prod");
  });
});
