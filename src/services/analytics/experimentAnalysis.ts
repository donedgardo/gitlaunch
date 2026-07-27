import {
  compareVariants,
  requiredSamplePerVariant,
  VariantComparison,
} from "./significance";

/**
 * Structural shape of the tallies this analysis needs — satisfied by
 * ExperimentResults from the flag layer, without coupling to it, so campaign
 * or funnel variants can be analysed the same way.
 */
export type ExperimentTallies = {
  flagKey: string;
  environment: string;
  variants: Array<{
    variant: string;
    exposures: number;
    conversions: number;
  }>;
};

export type Recommendation =
  | "ship"
  | "keep-control"
  | "keep-running"
  | "no-comparison";

export type ExperimentAnalysis = {
  flagKey: string;
  environment: string;
  baseline: string | null;
  comparisons: VariantComparison[];
  // The arm to ship. Only set once the experiment has both separated and run
  // long enough to be read, so it is safe to act on.
  winner: string | null;
  // The arm currently ahead on an experiment that is still too young to call.
  // Reportable, but not actionable — early leads flip.
  provisionalWinner: string | null;
  recommendation: Recommendation;
  // Per-arm sample needed to detect the effect size we care about.
  requiredSamplePerVariant: number;
  // How many more entities the smallest arm still needs; 0 once it is reached.
  shortfallPerVariant: number;
};

// Names treated as the holdout arm when picking a baseline. "(control)" is the
// label ExperimentResultsService gives an unnamed variant on a boolean rollout.
const CONTROL_NAMES = ["control", "(control)"];

// Default effect size worth detecting: a 20% relative change in the baseline
// conversion rate. Used to answer "is this experiment simply too young?".
export const DEFAULT_RELATIVE_MDE = 0.2;

// Fallback absolute effect size when the baseline has never converted, since a
// relative target off a zero rate would demand infinite traffic.
const FALLBACK_ABSOLUTE_MDE = 0.05;

/**
 * Turns raw per-variant tallies into a decision: which arm is the baseline,
 * how each challenger compares, and whether there is enough evidence to act.
 */
export function analyzeExperiment(
  results: ExperimentTallies,
  options: { alpha?: number; relativeMde?: number } = {},
): ExperimentAnalysis {
  const baseline = pickBaseline(results.variants);

  if (!baseline) {
    return {
      flagKey: results.flagKey,
      environment: results.environment,
      baseline: null,
      comparisons: [],
      winner: null,
      provisionalWinner: null,
      recommendation: "no-comparison",
      requiredSamplePerVariant: 0,
      shortfallPerVariant: 0,
    };
  }

  const challengers = results.variants.filter(
    (v) => v.variant !== baseline.variant,
  );
  const comparisons = challengers.map((challenger) =>
    compareVariants(baseline, challenger, { alpha: options.alpha }),
  );

  // The strongest arm that cleared the significance bar at this moment.
  const winners = comparisons.filter((c) => c.verdict === "winning");
  const leader =
    winners.length > 0
      ? winners.reduce((best, c) =>
          c.variantRate > best.variantRate ? c : best,
        ).variant
      : null;

  const baselineRate =
    baseline.exposures > 0 ? baseline.conversions / baseline.exposures : 0;
  const relativeMde = options.relativeMde ?? DEFAULT_RELATIVE_MDE;
  const required = requiredSamplePerVariant({
    baselineRate,
    minimumDetectableEffect:
      baselineRate > 0 ? baselineRate * relativeMde : FALLBACK_ABSOLUTE_MDE,
    alpha: options.alpha,
  });

  const smallestArm = Math.min(...results.variants.map((v) => v.exposures));
  const sampleReached = smallestArm >= required;

  // A significance test is only valid at its planned sample size. Results are
  // read continuously here, so acting on the first arm to cross p < 0.05 means
  // stopping on a lucky peek — which inflates false positives far above the
  // nominal 5%. A leader therefore only becomes a winner once the experiment
  // has collected the traffic it was planned for.
  //
  // Deliberately asymmetric: "keep control" is not gated. Abandoning a
  // challenger early leaves the status quo in place, and stopping a variant
  // that looks harmful is legitimate — the costly error is shipping on noise.
  const winner = sampleReached ? leader : null;
  const provisionalWinner = sampleReached ? null : leader;

  return {
    flagKey: results.flagKey,
    environment: results.environment,
    baseline: baseline.variant,
    comparisons,
    winner,
    provisionalWinner,
    recommendation: recommend(comparisons, winner),
    requiredSamplePerVariant: required,
    shortfallPerVariant: Math.max(0, required - smallestArm),
  };
}

function pickBaseline(variants: ExperimentTallies["variants"]) {
  if (variants.length < 2) return null;

  const named = variants.find((v) =>
    CONTROL_NAMES.includes(v.variant.toLowerCase()),
  );
  if (named) return named;

  // No holdout was named, so the arm carrying the most traffic is the most
  // stable thing to measure the others against.
  return variants.reduce((most, v) =>
    v.exposures > most.exposures ? v : most,
  );
}

function recommend(
  comparisons: VariantComparison[],
  winner: string | null,
): Recommendation {
  if (comparisons.length === 0) return "no-comparison";
  if (winner) return "ship";
  // Every challenger was decisively beaten, so control stands.
  if (comparisons.every((c) => c.verdict === "losing")) return "keep-control";
  return "keep-running";
}
