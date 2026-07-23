import { createHash } from "node:crypto";
import {
  Flag,
  FlagEnvironmentConfig,
  defaultEnvironmentConfig,
} from "../../repositories/flagRepository";

// One flag's evaluation-relevant config within a single environment. The bundle
// intentionally excludes descriptions and other metadata so a version is minted
// only when behaviour changes, not when documentation is edited.
export type BundleFlagEntry = {
  key: string;
  config: FlagEnvironmentConfig;
};

// An immutable snapshot of every flag's evaluation config for one
// service + environment. This is the unit that gets a version number and a
// content hash — the release artifact a customer can pin, download, or diff.
export type FlagConfigBundle = {
  environment: string;
  flags: BundleFlagEntry[]; // sorted by flag key (canonical order)
};

// Build the canonical config bundle for a service's flags in one environment.
// Entries are sorted by key so the result — and therefore its hash — is
// independent of the order flags come back from storage.
export function buildConfigBundle(
  flags: Flag[],
  envName: string,
): FlagConfigBundle {
  const entries: BundleFlagEntry[] = flags
    .map((flag) => ({
      key: flag.key,
      config: flag.environments[envName] ?? defaultEnvironmentConfig(),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return { environment: envName, flags: entries };
}

// Deterministic content hash of a bundle. Two bundles with the same effective
// evaluation config hash identically; any behavioural change flips the hash.
export function hashConfigBundle(bundle: FlagConfigBundle): string {
  return createHash("sha256").update(canonicalize(bundle)).digest("hex");
}

// Serialize with an explicit, fixed field order so the hash never depends on
// incidental object key ordering (e.g. from the storage driver).
function canonicalize(bundle: FlagConfigBundle): string {
  return JSON.stringify({
    environment: bundle.environment,
    flags: bundle.flags.map((f) => ({
      key: f.key,
      config: {
        enabled: f.config.enabled,
        rolloutPercentage: f.config.rolloutPercentage,
        variants: f.config.variants.map((v) => ({
          key: v.key,
          weight: v.weight,
        })),
      },
    })),
  });
}
