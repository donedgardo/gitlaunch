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

  it("should recommend shipping a challenger that wins significantly on a full sample", () => {
    // Given a challenger that clearly beats control, with both arms past the
    // sample the experiment was planned for
    const experiment = results([
      { variant: "control", exposures: 10000, conversions: 500 },
      { variant: "benefit-led", exposures: 10000, conversions: 800 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then it says to ship the winner and names it
    expect(analysis.recommendation).toBe("ship");
    expect(analysis.winner).toBe("benefit-led");
  });

  it("should refuse to call a winner before the planned sample, even when the gap is already significant", () => {
    // Given an early peek where the challenger is four times better and the
    // difference already clears p < 0.05 by chance
    const experiment = results([
      { variant: "control", exposures: 200, conversions: 10 },
      { variant: "benefit-led", exposures: 200, conversions: 40 },
    ]);

    // When I analyse it
    const analysis = analyzeExperiment(experiment);

    // Then it withholds the call — stopping at the first significant peek is
    // what inflates false positives — and names no winner to ship
    expect(analysis.recommendation).toBe("keep-running");
    expect(analysis.winner).toBeNull();
  });

  it("should name the arm that is currently ahead while it withholds the call", () => {
    const experiment = results([
      { variant: "control", exposures: 200, conversions: 10 },
      { variant: "benefit-led", exposures: 200, conversions: 40 },
    ]);

    const analysis = analyzeExperiment(experiment);

    // So the panel can say "ahead, but not callable" instead of "nothing yet"
    expect(analysis.provisionalWinner).toBe("benefit-led");
  });

  it("should keep reporting the outstanding shortfall when an early result looks significant", () => {
    const experiment = results([
      { variant: "control", exposures: 200, conversions: 10 },
      { variant: "benefit-led", exposures: 200, conversions: 40 },
    ]);

    const analysis = analyzeExperiment(experiment);

    // The shortfall must survive an apparent win — it is the whole reason the
    // customer has to wait
    expect(analysis.shortfallPerVariant).toBe(
      analysis.requiredSamplePerVariant - 200,
    );
  });

  it("should leave no provisional winner when nothing is significant yet", () => {
    const experiment = results([
      { variant: "control", exposures: 100, conversions: 5 },
      { variant: "benefit-led", exposures: 100, conversions: 7 },
    ]);

    const analysis = analyzeExperiment(experiment);

    expect(analysis.provisionalWinner).toBeNull();
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
    // Given a decided experiment that has run past its planned sample
    const experiment = results([
      { variant: "control", exposures: 10000, conversions: 500 },
      { variant: "benefit-led", exposures: 10000, conversions: 800 },
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
