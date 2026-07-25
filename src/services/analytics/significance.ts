/**
 * Frequentist significance testing for A/B experiments.
 *
 * Pure functions over already-counted variant tallies, so they work for any
 * source of exposure/conversion counts (flag experiments today, campaign or
 * funnel variants later) and stay trivially testable.
 */

export type VariantTally = {
  variant: string;
  exposures: number;
  conversions: number;
};

export type Verdict =
  | "winning"
  | "losing"
  | "inconclusive"
  | "insufficient-data";

export type VariantComparison = {
  baseline: string;
  variant: string;
  baselineRate: number;
  variantRate: number;
  // Difference in conversion rate, in percentage points expressed as a fraction.
  absoluteLift: number;
  // Difference as a share of the baseline rate; null when the baseline never
  // converted (dividing by zero would report an infinite lift).
  relativeLift: number | null;
  zScore: number | null;
  // Two-tailed p-value; null when there is nothing to test.
  pValue: number | null;
  confidence: number | null;
  significant: boolean;
  verdict: Verdict;
};

const DEFAULT_ALPHA = 0.05;

/**
 * Two-proportion z-test comparing a challenger against a baseline variant.
 * Reports the observed lift plus whether the difference clears the
 * significance threshold, so a caller never has to eyeball raw rates.
 */
export function compareVariants(
  baseline: VariantTally,
  challenger: VariantTally,
  options: { alpha?: number } = {},
): VariantComparison {
  const alpha = options.alpha ?? DEFAULT_ALPHA;

  const baselineRate = rate(baseline);
  const variantRate = rate(challenger);
  const absoluteLift = variantRate - baselineRate;
  const relativeLift = baselineRate > 0 ? absoluteLift / baselineRate : null;

  const base: Omit<
    VariantComparison,
    "zScore" | "pValue" | "confidence" | "significant" | "verdict"
  > = {
    baseline: baseline.variant,
    variant: challenger.variant,
    baselineRate,
    variantRate,
    absoluteLift,
    relativeLift,
  };

  // With an empty arm there is no distribution to compare against.
  if (baseline.exposures <= 0 || challenger.exposures <= 0) {
    return {
      ...base,
      zScore: null,
      pValue: null,
      confidence: null,
      significant: false,
      verdict: "insufficient-data",
    };
  }

  // Pooled proportion under the null hypothesis that both arms convert alike.
  const pooled =
    (baseline.conversions + challenger.conversions) /
    (baseline.exposures + challenger.exposures);
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / baseline.exposures + 1 / challenger.exposures),
  );

  // Identical arms with no variance (e.g. nobody converted anywhere) leave
  // nothing to distinguish, so report no effect rather than dividing by zero.
  if (standardError === 0) {
    return {
      ...base,
      zScore: null,
      pValue: null,
      confidence: null,
      significant: false,
      verdict: "insufficient-data",
    };
  }

  const zScore = absoluteLift / standardError;
  const pValue = twoTailedPValue(zScore);
  const significant = pValue < alpha;

  return {
    ...base,
    zScore,
    pValue,
    confidence: 1 - pValue,
    significant,
    verdict: significant
      ? absoluteLift > 0
        ? "winning"
        : "losing"
      : "inconclusive",
  };
}

/**
 * How many entities each arm needs before an effect of the requested size
 * could be detected. Answers "is this experiment just too young to call?".
 */
export function requiredSamplePerVariant(params: {
  baselineRate: number;
  minimumDetectableEffect: number;
  alpha?: number;
  power?: number;
}): number {
  const alpha = params.alpha ?? DEFAULT_ALPHA;
  const power = params.power ?? 0.8;

  const p1 = params.baselineRate;
  const p2 = Math.min(1, Math.max(0, p1 + params.minimumDetectableEffect));
  const delta = p2 - p1;
  if (delta === 0) return Infinity;

  const zAlpha = zForTail(alpha / 2);
  const zBeta = zForTail(1 - power);
  const variance = p1 * (1 - p1) + p2 * (1 - p2);

  return Math.ceil(((zAlpha + zBeta) ** 2 * variance) / delta ** 2);
}

function rate(tally: VariantTally): number {
  return tally.exposures > 0 ? tally.conversions / tally.exposures : 0;
}

// P(|Z| > |z|) for a standard normal.
function twoTailedPValue(z: number): number {
  return erfc(Math.abs(z) / Math.SQRT2);
}

/**
 * Complementary error function (Numerical Recipes' Chebyshev fit), relative
 * accuracy ~1.2e-7 — plenty for reporting p-values, and it stays accurate deep
 * in the tail where a naive CDF would round to zero.
 */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t *
                                  (1.48851587 +
                                    t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? ans : 2 - ans;
}

/**
 * Inverse standard-normal for an upper-tail probability (Acklam's rational
 * approximation). zForTail(0.025) ≈ 1.96.
 */
function zForTail(tail: number): number {
  const p = 1 - tail;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}
