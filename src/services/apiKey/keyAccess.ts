import { ApiKeyScope } from "../../repositories/apiKeyRepository";

// What a secret key may do, as the three choices offered when minting one.
// Scopes stay the unit of enforcement; a level is only a named set of them, so
// the routes never ask "is this a release key?", only "does it carry the scope?".
export type KeyAccessLevel = "full" | "release" | "read";

export type KeyAccessLevelDefinition = {
  level: KeyAccessLevel;
  label: string;
  description: string;
  scopes: readonly ApiKeyScope[];
};

export const KEY_ACCESS_LEVELS: readonly KeyAccessLevelDefinition[] = [
  {
    level: "full",
    label: "Full access",
    description:
      "Report builds, deploy, switch flags and change service settings. For CI pipelines and setup.",
    scopes: [
      "builds:read",
      "builds:write",
      "deployments:write",
      "services:read",
      "services:write",
      "flags:read",
      "flags:write",
    ],
  },
  {
    level: "release",
    label: "Release",
    description:
      "Deploy builds and switch flags, and read everything. Cannot report builds or change service settings. For agents and release tooling.",
    scopes: [
      "builds:read",
      "services:read",
      "flags:read",
      "deployments:write",
      "flags:write",
    ],
  },
  {
    level: "read",
    label: "Read-only",
    description:
      "See builds, environments, flags and delivery metrics. Changes nothing.",
    scopes: ["builds:read", "services:read", "flags:read"],
  },
];

export function scopesFor(level: KeyAccessLevel): ApiKeyScope[] {
  const definition = KEY_ACCESS_LEVELS.find((l) => l.level === level)!;
  return [...definition.scopes];
}

// Nothing chosen means full access: that is what every key was before levels
// existed, and what a caller that predates the choice still expects. An unknown
// value is refused (null) rather than quietly widened or narrowed.
export function parseAccessLevel(raw: unknown): KeyAccessLevel | null {
  if (raw === undefined || raw === null || raw === "") return "full";
  const known = KEY_ACCESS_LEVELS.find((l) => l.level === raw);
  return known ? known.level : null;
}

export function describeAccess(scopes: readonly ApiKeyScope[]): string {
  const held = new Set(scopes);
  const match = KEY_ACCESS_LEVELS.find(
    (l) => l.scopes.length === held.size && l.scopes.every((s) => held.has(s)),
  );
  return match ? match.label : "Custom";
}

type EnvironmentLimit = { allowedEnvironments?: readonly string[] | null };

// An absent or empty list is no limit at all — the state of every key minted
// before limits existed. A key cannot be limited to "nowhere".
export function isEnvironmentLimited(key: EnvironmentLimit): boolean {
  return (key.allowedEnvironments?.length ?? 0) > 0;
}

// Names are compared exactly. Environments are whatever a service calls them,
// so there is no safe notion of "close enough" to a name on the list.
export function mayActOnEnvironment(
  key: EnvironmentLimit,
  environment: string,
): boolean {
  if (!isEnvironmentLimited(key)) return true;
  return key.allowedEnvironments!.includes(environment);
}

export function describeEnvironments(key: EnvironmentLimit): string {
  if (!isEnvironmentLimited(key)) return "all environments";
  return `${key.allowedEnvironments!.join(", ")} only`;
}

// Accepts what a form sends: one comma-separated field, or the field repeated.
export function parseEnvironmentList(
  raw: string | readonly string[] | undefined | null,
): string[] {
  if (!raw) return [];
  const parts = (typeof raw === "string" ? [raw] : [...raw]).flatMap((p) =>
    p.split(","),
  );
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
}
