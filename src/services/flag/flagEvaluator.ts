import { createHash } from "node:crypto";
import type {
  FlagEnvironmentConfig,
  TargetingCondition,
  TargetingRule,
} from "../../repositories/flagRepository";

export type FlagEvaluationReason =
  | "disabled"
  | "not_in_rollout"
  | "rollout"
  | "variant"
  | "targeting_rule";

// Entity attributes supplied at evaluation time, used to match targeting rules.
// Values are compared as strings, so scalars are coerced with String().
export type FlagAttributes = Record<string, string | number | boolean>;

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

// Evaluate a single targeting condition against the entity's attributes. A
// missing attribute never matches — including for negative operators — so a
// rule only applies to entities that actually carry the attribute it targets.
function matchesCondition(
  cond: TargetingCondition,
  attributes: FlagAttributes,
): boolean {
  const raw = attributes[cond.attribute];
  if (raw === undefined || raw === null) {
    return false;
  }
  const actual = String(raw);
  switch (cond.operator) {
    case "eq":
      return cond.values.length > 0 && actual === cond.values[0];
    case "neq":
      return cond.values.length > 0 && actual !== cond.values[0];
    case "in":
      return cond.values.includes(actual);
    case "not_in":
      return !cond.values.includes(actual);
    case "contains":
      return cond.values.length > 0 && actual.includes(cond.values[0]);
    default:
      return false;
  }
}

// A rule matches when every one of its conditions matches (AND).
function matchesRule(rule: TargetingRule, attributes: FlagAttributes): boolean {
  return (
    rule.conditions.length > 0 &&
    rule.conditions.every((c) => matchesCondition(c, attributes))
  );
}

export function evaluateFlag(
  cfg: FlagEnvironmentConfig,
  key: string,
  entityKey: string,
  attributes: FlagAttributes = {},
): FlagEvaluation {
  if (!cfg.enabled) {
    return { key, enabled: false, variant: null, reason: "disabled" };
  }

  // Targeting rules take precedence over the rollout gate: an explicit segment
  // match always serves its outcome. First matching rule wins.
  for (const rule of cfg.targetingRules ?? []) {
    if (matchesRule(rule, attributes)) {
      return {
        key,
        enabled: true,
        variant: rule.serve ?? null,
        reason: "targeting_rule",
      };
    }
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
