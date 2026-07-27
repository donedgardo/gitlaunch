import { ReleaseContents } from "./release";

// Promotion is how a release becomes an environment's desired state. In the
// pull model nothing is dispatched: the plan is written down, and whichever
// agent owns that environment reconciles toward it on its next poll. Keeping
// the decision pure means the same gate runs identically for a cloud target
// and an edge fleet.

export type PromotionPlan = {
  kind: "promotion";
  version: string;
  environment: string;
  // What the environment desired before this promotion — null when it has
  // never had a release. Carried so callers can render "1.3.0 → 1.4.2".
  previousVersion: string | null;
};

export type PromotionBlocked = {
  kind: "promotion-blocked";
  reason: string;
};

export type PlanPromotionResult = PromotionPlan | PromotionBlocked;

// env name -> version that environment currently desires
export type DesiredVersions = Record<string, string | undefined>;

export function planPromotion(
  release: ReleaseContents,
  environment: string,
  environments: { name: string; order: number }[],
  desiredVersions: DesiredVersions,
): PlanPromotionResult {
  if (release.artifacts.length === 0) {
    return blocked(`Release ${release.version} has no artifacts to deliver`);
  }

  const target = environments.find((e) => e.name === environment);
  if (!target) {
    return blocked(`"${environment}" is not an environment of this service`);
  }

  if (desiredVersions[environment] === release.version) {
    return blocked(
      `Release ${release.version} is already the desired release for "${environment}"`,
    );
  }

  // The gate: a release reaches an environment only after every earlier one.
  // `order` is relative, so sparse or renumbered orders behave the same.
  const earliestGap = environments
    .filter((e) => e.order < target.order)
    .sort((a, b) => a.order - b.order)
    .find((e) => desiredVersions[e.name] !== release.version);
  if (earliestGap) {
    return blocked(
      `Release ${release.version} must reach "${earliestGap.name}" before "${environment}"`,
    );
  }

  return {
    kind: "promotion",
    version: release.version,
    environment,
    previousVersion: desiredVersions[environment] ?? null,
  };
}

function blocked(reason: string): PromotionBlocked {
  return { kind: "promotion-blocked", reason };
}
