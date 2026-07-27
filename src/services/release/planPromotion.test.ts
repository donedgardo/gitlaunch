import { describe, it, expect } from "vitest";
import {
  planPromotion,
  PromotionBlocked,
  PromotionPlan,
} from "./planPromotion";
import { ReleaseArtifact } from "./release";

describe("planPromotion", () => {
  const chart: ReleaseArtifact = {
    kind: "helm-chart",
    repository: "oci://ghcr.io/acme/charts",
    chart: "api",
    version: "1.4.2",
  };
  const release = { version: "1.4.2", artifacts: [chart] };
  const environments = [
    { name: "staging", order: 0 },
    { name: "prod", order: 1 },
  ];

  it("should plan a promotion to the first environment when nothing is deployed yet", () => {
    // Given a release and an empty desired state
    // When I promote it to the lowest-order environment
    const result = planPromotion(release, "staging", environments, {});

    // Then the promotion is planned with no previous version
    expect(result).toEqual({
      kind: "promotion",
      version: "1.4.2",
      environment: "staging",
      previousVersion: null,
    });
  });

  it("should report the version being replaced when the environment already runs a release", () => {
    // Given prod already has an older release as its desired state
    const desired = { staging: "1.4.2", prod: "1.3.0" };

    // When I promote the newer release to prod
    const result = planPromotion(release, "prod", environments, desired);

    // Then the plan names the version it replaces
    expect(result).toEqual({
      kind: "promotion",
      version: "1.4.2",
      environment: "prod",
      previousVersion: "1.3.0",
    });
  });

  it("should block promotion to a later environment before earlier ones have the release", () => {
    // Given the release has not reached staging
    // When I try to promote it straight to prod
    const result = planPromotion(release, "prod", environments, {});

    // Then the promotion is blocked by the ordered-environment gate
    expect((result as PromotionBlocked).kind).toBe("promotion-blocked");
    expect((result as PromotionBlocked).reason).toBe(
      'Release 1.4.2 must reach "staging" before "prod"',
    );
  });

  it("should name only the earliest missing environment when several are skipped", () => {
    // Given a three-stage pipeline where the release has reached none of them
    const threeStage = [
      { name: "dev", order: 0 },
      { name: "staging", order: 1 },
      { name: "prod", order: 2 },
    ];

    // When I try to promote straight to prod
    const result = planPromotion(release, "prod", threeStage, {});

    // Then the earliest gap is the one reported
    expect((result as PromotionBlocked).reason).toBe(
      'Release 1.4.2 must reach "dev" before "prod"',
    );
  });

  it("should block promotion when the release is already the desired state", () => {
    // Given prod already desires this exact release
    const desired = { staging: "1.4.2", prod: "1.4.2" };

    // When I promote it again
    const result = planPromotion(release, "prod", environments, desired);

    // Then it is blocked as a no-op
    expect((result as PromotionBlocked).kind).toBe("promotion-blocked");
    expect((result as PromotionBlocked).reason).toBe(
      'Release 1.4.2 is already the desired release for "prod"',
    );
  });

  it("should block promotion to an environment the service does not have", () => {
    // Given a service with staging and prod
    // When I promote to an environment that is not configured
    const result = planPromotion(release, "canary", environments, {});

    // Then it is blocked
    expect((result as PromotionBlocked).kind).toBe("promotion-blocked");
    expect((result as PromotionBlocked).reason).toBe(
      '"canary" is not an environment of this service',
    );
  });

  it("should block promotion of a release that carries no artifacts", () => {
    // Given a release with nothing to deliver
    const empty = { version: "1.4.2", artifacts: [] };

    // When I promote it
    const result = planPromotion(empty, "staging", environments, {});

    // Then there is nothing for an agent to reconcile
    expect((result as PromotionBlocked).kind).toBe("promotion-blocked");
    expect((result as PromotionBlocked).reason).toBe(
      "Release 1.4.2 has no artifacts to deliver",
    );
  });

  it("should ignore environment ordering gaps and rely on relative order", () => {
    // Given environments whose order values are sparse (10, 20)
    const sparse = [
      { name: "staging", order: 10 },
      { name: "prod", order: 20 },
    ];
    const desired = { staging: "1.4.2" };

    // When I promote to prod after staging has the release
    const result = planPromotion(release, "prod", sparse, desired);

    // Then the promotion is allowed
    expect((result as PromotionPlan).kind).toBe("promotion");
  });

  it("should allow promotion to an earlier environment regardless of later ones", () => {
    // Given prod runs an unrelated newer release
    const desired = { prod: "2.0.0" };

    // When I promote to staging, the lowest-order environment
    const result = planPromotion(release, "staging", environments, desired);

    // Then nothing gates it — the gate only looks at earlier environments
    expect((result as PromotionPlan).kind).toBe("promotion");
  });
});
