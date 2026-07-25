import { describe, it, expect } from "vitest";
import { renderInsightsReport, InsightsReport } from "./insightsReport";

const emptyReport: InsightsReport = {
  from: new Date("2026-07-01T00:00:00Z"),
  to: new Date("2026-07-08T00:00:00Z"),
  campaigns: [],
  experiments: [],
  usage: { activeUsers: [], features: [], funnel: [] },
  warnings: [],
};

describe("renderInsightsReport", () => {
  it("should state the window the report covers", () => {
    // Given a report over a known window
    // When I render it
    const output = renderInsightsReport(emptyReport);

    // Then the reader can see which dates it describes
    expect(output).toContain("2026-07-01");
    expect(output).toContain("2026-07-08");
  });

  it("should list each campaign with its signups", () => {
    // Given a campaign that produced signups
    const output = renderInsightsReport({
      ...emptyReport,
      campaigns: [
        {
          campaign: "alpha_launch",
          source: "dm",
          medium: "whatsapp",
          signups: 4,
          uniqueVisitors: 3,
          firstSignup: new Date("2026-07-02T00:00:00Z"),
          lastSignup: new Date("2026-07-04T00:00:00Z"),
        },
      ],
    });

    // Then the campaign and its numbers appear
    expect(output).toContain("alpha_launch");
    expect(output).toContain("whatsapp");
    expect(output).toMatch(/\b4\b/);
  });

  it("should say so plainly when a section has no data", () => {
    // Given a report with nothing in it
    // When I render it
    const output = renderInsightsReport(emptyReport);

    // Then the reader is told there is no data rather than shown blank tables
    expect(output.toLowerCase()).toContain("no campaign");
    expect(output.toLowerCase()).toContain("no experiment");
  });

  it("should give an undecided experiment a plain-language next step", () => {
    // Given an experiment that is still too small to call
    const output = renderInsightsReport({
      ...emptyReport,
      experiments: [
        {
          flagKey: "waitlist-hero-copy",
          environment: "prod",
          baseline: "control",
          winner: null,
          recommendation: "keep-running",
          requiredSamplePerVariant: 9450,
          shortfallPerVariant: 9429,
          comparisons: [
            {
              baseline: "control",
              variant: "benefit-led",
              baselineRate: 0.0435,
              variantRate: 0.0476,
              absoluteLift: 0.0041,
              relativeLift: 0.094,
              zScore: 0.066,
              pValue: 0.947,
              confidence: 0.053,
              significant: false,
              verdict: "inconclusive",
            },
          ],
        },
      ],
    });

    // Then it says to keep running and how much more traffic is needed
    expect(output).toContain("waitlist-hero-copy");
    expect(output.toLowerCase()).toContain("keep running");
    expect(output).toContain("9,429");
  });

  it("should call out a winning experiment", () => {
    // Given an experiment with a significant winner
    const output = renderInsightsReport({
      ...emptyReport,
      experiments: [
        {
          flagKey: "waitlist-hero-copy",
          environment: "prod",
          baseline: "control",
          winner: "benefit-led",
          recommendation: "ship",
          requiredSamplePerVariant: 500,
          shortfallPerVariant: 0,
          comparisons: [
            {
              baseline: "control",
              variant: "benefit-led",
              baselineRate: 0.05,
              variantRate: 0.08,
              absoluteLift: 0.03,
              relativeLift: 0.6,
              zScore: 6.08,
              pValue: 0.0000001,
              confidence: 0.9999999,
              significant: true,
              verdict: "winning",
            },
          ],
        },
      ],
    });

    // Then the winner is named as the thing to ship
    expect(output.toLowerCase()).toContain("ship");
    expect(output).toContain("benefit-led");
  });

  it("should surface data quality warnings", () => {
    // Given a warning about events that cannot be attributed
    const output = renderInsightsReport({
      ...emptyReport,
      warnings: ["1 waitlist_signup event has no accountId"],
    });

    // Then the warning is shown to the reader
    expect(output).toContain("1 waitlist_signup event has no accountId");
  });

  it("should show the product usage it was given", () => {
    // Given usage figures
    const output = renderInsightsReport({
      ...emptyReport,
      usage: {
        activeUsers: [{ bucket: new Date("2026-07-02T00:00:00Z"), users: 3 }],
        features: [{ event: "build_reported", users: 2, occurrences: 20 }],
        funnel: [
          {
            step: "user_logged_in",
            users: 4,
            rateFromStart: 1,
            rateFromPrevious: 1,
          },
          {
            step: "build_reported",
            users: 2,
            rateFromStart: 0.5,
            rateFromPrevious: 0.5,
          },
        ],
      },
    });

    // Then the features and the funnel drop-off are visible
    expect(output).toContain("build_reported");
    expect(output).toContain("50.0%");
  });
});
