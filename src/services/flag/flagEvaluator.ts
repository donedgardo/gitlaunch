import { createHash } from "node:crypto";
import type { FlagEnvironmentConfig } from "../../repositories/flagRepository";

export type FlagEvaluationReason =
  | "disabled"
  | "not_in_rollout"
  | "rollout"
  | "variant";

export type FlagEvaluation = {
  key: string;
  enabled: boolean;
  variant: string | null;
  reason: FlagEvaluationReason;
};

// Deterministic bucket in [0, mod) derived from a stable hash of the input.
// Uses the first 4 bytes of a sha256 digest as an unsigned 32-bit integer so
// the same input always maps to the same bucket across calls and processes.
function bucket(input: string, mod: number): number {
  const digest = createHash("sha256").update(input).digest();
  const value = digest.readUInt32BE(0);
  return value % mod;
}

// Assign a variant by walking cumulative weights over a 0..99 bucket.
function pickVariant(
  variants: { key: string; weight: number }[],
  entitySeed: string,
): string {
  const vbucket = bucket(entitySeed, 100);
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (vbucket < cumulative) {
      return variant.key;
    }
  }
  // Fallback (weights should sum to 100, but guard rounding gaps).
  return variants[variants.length - 1].key;
}

export function evaluateFlag(
  cfg: FlagEnvironmentConfig,
  key: string,
  entityKey: string,
): FlagEvaluation {
  if (!cfg.enabled) {
    return { key, enabled: false, variant: null, reason: "disabled" };
  }

  // Rollout gate — independent salt so it doesn't correlate with variant split.
  const rolloutBucket = bucket(`${key}:rollout:${entityKey}`, 100);
  if (rolloutBucket >= cfg.rolloutPercentage) {
    return { key, enabled: false, variant: null, reason: "not_in_rollout" };
  }

  if (cfg.variants.length > 0) {
    const variant = pickVariant(cfg.variants, `${key}:variant:${entityKey}`);
    return { key, enabled: true, variant, reason: "variant" };
  }

  return { key, enabled: true, variant: null, reason: "rollout" };
}
