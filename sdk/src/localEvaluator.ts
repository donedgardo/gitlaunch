// Vendored port of src/services/flag/flagEvaluator.ts's targeting/rollout/
// variant logic. The SDK ships to customers' browsers and can't import
// server-only code (this package isn't a workspace, and its published `files`
// allowlist is dist/README/LICENSE only) — so this is a deliberate second
// copy, kept honest by both sides running the same golden-vector fixture
// (see localEvaluator.test.ts and flagEvaluator.test.ts).
//
// The one real divergence from the server: hashing goes through Web Crypto,
// which is async-only in browsers, so evaluation here is async end-to-end —
// fine, since the SDK's public API already is.

export type FlagVariant = {
  key: string;
  weight: number;
};

export type TargetingOperator = "eq" | "neq" | "in" | "not_in" | "contains";

export type TargetingCondition = {
  attribute: string;
  operator: TargetingOperator;
  values: string[];
};

export type TargetingRule = {
  conditions: TargetingCondition[];
  serve: string | null;
};

export type FlagEnvironmentConfig = {
  enabled: boolean;
  rolloutPercentage: number;
  variants: FlagVariant[];
  targetingRules?: TargetingRule[];
};

export type FlagEvaluationReason =
  | "disabled"
  | "not_in_rollout"
  | "rollout"
  | "variant"
  | "targeting_rule";

export type FlagAttributes = Record<string, string | number | boolean>;

export type FlagEvaluation = {
  key: string;
  enabled: boolean;
  variant: string | null;
  reason: FlagEvaluationReason;
};

// Browsers expose SHA-256 only via the async Web Crypto API. The dynamic
// import is what keeps a bundler from ever statically resolving "node:crypto"
// into a browser build — it's only reached on runtimes with no global crypto.
async function digestSha256(data: Uint8Array): Promise<ArrayBuffer> {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle.digest("SHA-256", data);
  }
  const { webcrypto } = await import("node:crypto");
  return webcrypto.subtle.digest("SHA-256", data);
}

// Deterministic bucket in [0, mod), matching the server's
// createHash("sha256").update(input).digest().readUInt32BE(0) % mod exactly —
// the first 4 bytes of the digest read as an unsigned 32-bit big-endian int.
async function bucket(input: string, mod: number): Promise<number> {
  const digest = await digestSha256(new TextEncoder().encode(input));
  return new DataView(digest).getUint32(0, false) % mod;
}

async function pickVariant(
  variants: FlagVariant[],
  entitySeed: string,
): Promise<string> {
  const vbucket = await bucket(entitySeed, 100);
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (vbucket < cumulative) {
      return variant.key;
    }
  }
  return variants[variants.length - 1].key;
}

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

function matchesRule(rule: TargetingRule, attributes: FlagAttributes): boolean {
  return (
    rule.conditions.length > 0 &&
    rule.conditions.every((c) => matchesCondition(c, attributes))
  );
}

export async function evaluateFlagLocally(
  cfg: FlagEnvironmentConfig,
  key: string,
  entityKey: string,
  attributes: FlagAttributes = {},
): Promise<FlagEvaluation> {
  if (!cfg.enabled) {
    return { key, enabled: false, variant: null, reason: "disabled" };
  }

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

  const rolloutBucket = await bucket(`${key}:rollout:${entityKey}`, 100);
  if (rolloutBucket >= cfg.rolloutPercentage) {
    return { key, enabled: false, variant: null, reason: "not_in_rollout" };
  }

  if (cfg.variants.length > 0) {
    const variant = await pickVariant(
      cfg.variants,
      `${key}:variant:${entityKey}`,
    );
    return { key, enabled: true, variant, reason: "variant" };
  }

  return { key, enabled: true, variant: null, reason: "rollout" };
}
