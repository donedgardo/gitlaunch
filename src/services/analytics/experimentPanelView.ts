import { analyzeExperiment, DEFAULT_RELATIVE_MDE } from "./experimentAnalysis";

/**
 * Presents experiment tallies as the customer-facing results panel: the same
 * per-variant rates as before, plus the decision layer the team already gets
 * from the internal briefing — which arm is the baseline, how each challenger
 * compares, and whether there is enough evidence to act yet.
 *
 * Structural input (satisfied by ExperimentResults) so the analytics layer
 * stays independent of the flag layer, matching experimentAnalysis.
 */
export type ExperimentPanelInput = {
  flagKey: string;
  environment: string;
  variants: Array<{
    variant: string;
    exposures: number;
    conversions: number;
    conversionRate: number;
  }>;
  totals: {
    exposures: number;
    conversions: number;
    conversionRate: number;
  };
};

export type ExperimentPanelVariant = {
  variant: string;
  exposures: number;
  conversions: number;
  conversionRatePct: string;
  barPct: number;
  isBaseline: boolean;
  significant: boolean;
  // Relative lift against the baseline, signed. Absent on the baseline row and
  // when the baseline never converted (a relative lift off zero is undefined).
  liftPct?: string;
  // Signed percentage-point difference — always available for a challenger, so
  // the panel can still say something when liftPct can't be computed.
  absoluteLiftPts?: string;
  confidencePct?: string;
};

// Drives the badge styling as well as its wording.
export type DecisionTone = "ship" | "control" | "running" | "none";

export type ExperimentPanelDecision = {
  label: string;
  tone: DecisionTone;
  detail: string;
};

export type ExperimentPanelView = {
  flagKey: string;
  environment: string;
  hasData: boolean;
  totals: {
    exposures: number;
    conversions: number;
    conversionRatePct: string;
  };
  variants: ExperimentPanelVariant[];
  decision?: ExperimentPanelDecision;
};

// The effect size the shortfall is quoted against. Derived from the analysis
// default so the copy can never drift from the number it explains.
const RELATIVE_MDE_LABEL = `${Math.round(DEFAULT_RELATIVE_MDE * 100)}%`;

export type ExperimentPanelsView = {
  flagKey: string;
  hasData: boolean;
  environments: ExperimentPanelView[];
};

/**
 * One panel per environment the experiment ran in. Environments are parallel
 * rather than a promotion ladder, so no single one is "the" result — and each
 * is judged on its own evidence, since an experiment can be callable in one
 * environment while still too young in another.
 */
export function toExperimentPanelsView(
  flagKey: string,
  resultsByEnvironment: ExperimentPanelInput[],
): ExperimentPanelsView {
  const environments = resultsByEnvironment.map(toExperimentPanelView);
  return {
    flagKey,
    hasData: environments.some((e) => e.hasData),
    environments,
  };
}

export function toExperimentPanelView(
  results: ExperimentPanelInput,
): ExperimentPanelView {
  const analysis = analyzeExperiment(results);
  const comparisons = new Map(analysis.comparisons.map((c) => [c.variant, c]));

  // Bars stay relative to the best-performing arm, as the panel already showed.
  const best = results.variants.reduce(
    (max, v) => Math.max(max, v.conversionRate),
    0,
  );

  const variants: ExperimentPanelVariant[] = results.variants.map((v) => {
    const comparison = comparisons.get(v.variant);
    return {
      variant: v.variant,
      exposures: v.exposures,
      conversions: v.conversions,
      conversionRatePct: pct(v.conversionRate),
      barPct: best > 0 ? Math.round((v.conversionRate / best) * 100) : 0,
      isBaseline: analysis.baseline === v.variant,
      significant: comparison?.significant ?? false,
      liftPct:
        comparison?.relativeLift != null
          ? signed(comparison.relativeLift * 100)
          : undefined,
      absoluteLiftPts: comparison
        ? signed(comparison.absoluteLift * 100)
        : undefined,
      confidencePct:
        comparison?.confidence != null ? pct(comparison.confidence) : undefined,
    };
  });

  const hasData = results.totals.exposures > 0;

  return {
    flagKey: results.flagKey,
    environment: results.environment,
    hasData,
    totals: {
      exposures: results.totals.exposures,
      conversions: results.totals.conversions,
      conversionRatePct: pct(results.totals.conversionRate),
    },
    variants,
    decision: hasData ? describeDecision(analysis, variants) : undefined,
  };
}

function describeDecision(
  analysis: ReturnType<typeof analyzeExperiment>,
  variants: ExperimentPanelVariant[],
): ExperimentPanelDecision {
  const baseline = analysis.baseline ?? "the baseline";

  switch (analysis.recommendation) {
    case "ship": {
      const winner = analysis.winner!;
      const row = variants.find((v) => v.variant === winner);
      const margin = row?.liftPct
        ? `by ${row.liftPct}%`
        : `by ${row?.absoluteLiftPts ?? "0.0"} points`;
      return {
        label: `Ship ${winner}`,
        tone: "ship",
        detail: `${winner} beat ${baseline} ${margin} at ${row?.confidencePct ?? "95.0"}% confidence.`,
      };
    }
    case "keep-control":
      return {
        label: `Keep ${baseline}`,
        tone: "control",
        detail: `Every challenger converted significantly worse than ${baseline}.`,
      };
    case "no-comparison":
      return {
        label: "Nothing to compare",
        tone: "none",
        detail:
          "Only one arm has recorded traffic, so there is no baseline to test against.",
      };
    case "keep-running":
    default: {
      const outstanding =
        analysis.shortfallPerVariant > 0
          ? `about ${count(analysis.shortfallPerVariant)} more per arm to detect a ${RELATIVE_MDE_LABEL} change`
          : `more traffic before it can be called`;
      // An arm that is ahead this early is real information but not a result:
      // saying "nothing has separated" would be untrue, and calling it a winner
      // is what the sample gate exists to prevent.
      return {
        label: "Keep running",
        tone: "running",
        detail: analysis.provisionalWinner
          ? `${analysis.provisionalWinner} is ahead, but early leads flip — needs ${outstanding}.`
          : `No arm has separated yet — needs ${outstanding}.`,
      };
    }
  }
}

function pct(fraction: number): string {
  return (fraction * 100).toFixed(1);
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}
