import { describe, it, expect } from "vitest";
import { resolveEntitlement, SelfHostedLicense } from "./resolveEntitlement";
import { Plan, PRO_PLAN_LIMITS } from "../../repositories/accountRepository";

describe("resolveEntitlement", () => {
  const now = new Date("2026-07-27T00:00:00Z");

  const account = {
    plan: Plan.Pro,
    planLimits: PRO_PLAN_LIMITS,
  };

  const license: SelfHostedLicense = {
    licensedTo: "Acme Corp",
    maxUsers: 50,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  };

  describe("hosted SaaS instance", () => {
    it("should keep the account's own plan limits", () => {
      // Given gitlaunch.com, where Stripe governs entitlement
      // When I resolve what the account may do
      const entitlement = resolveEntitlement({ kind: "saas" }, account, now);

      // Then nothing changes — the plan the account pays for wins
      expect(entitlement.limits).toEqual(PRO_PLAN_LIMITS);
    });

    it("should leave billing in charge of trials and payment state", () => {
      // Given the hosted instance
      // When I resolve entitlement
      const entitlement = resolveEntitlement({ kind: "saas" }, account, now);

      // Then trial countdown and payment-failure read-only still apply
      expect(entitlement.billingEnforced).toBe(true);
      expect(entitlement.blockedReason).toBeNull();
    });
  });

  describe("licensed self-hosted instance", () => {
    it("should lift the resource limits the customer already paid for", () => {
      // Given a self-hosted install with a valid license
      const mode = { kind: "self-hosted" as const, license };

      // When I resolve entitlement for an account still marked Free
      const entitlement = resolveEntitlement(
        mode,
        { plan: Plan.Free, planLimits: { ...PRO_PLAN_LIMITS } },
        now,
      );

      // Then the SaaS tier limits no longer throttle the install
      expect(entitlement.limits.maxRepositories).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlement.limits.maxServices).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlement.limits.maxEnvironments).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlement.limits.publicReposOnly).toBe(false);
    });

    it("should cap users at the number of seats sold", () => {
      // Given a 50-seat license
      const mode = { kind: "self-hosted" as const, license };

      // When I resolve entitlement
      const entitlement = resolveEntitlement(mode, account, now);

      // Then seats are the one limit the license still enforces
      expect(entitlement.limits.maxUsers).toBe(50);
    });

    it("should allow unlimited seats when the license sells them", () => {
      // Given a site license with no seat cap
      const mode = {
        kind: "self-hosted" as const,
        license: { ...license, maxUsers: null },
      };

      // When I resolve entitlement
      const entitlement = resolveEntitlement(mode, account, now);

      // Then seats are uncapped
      expect(entitlement.limits.maxUsers).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("should take Stripe out of the loop entirely", () => {
      // Given a self-hosted install that will never see a Stripe webhook
      const mode = { kind: "self-hosted" as const, license };

      // When I resolve entitlement
      const entitlement = resolveEntitlement(mode, account, now);

      // Then trials, payment failures and read-only downgrades do not apply
      expect(entitlement.billingEnforced).toBe(false);
      expect(entitlement.blockedReason).toBeNull();
    });

    it("should treat a perpetual license as always current", () => {
      // Given a license with no expiry
      const mode = {
        kind: "self-hosted" as const,
        license: { ...license, expiresAt: null },
      };

      // When I resolve entitlement far in the future
      const entitlement = resolveEntitlement(
        mode,
        account,
        new Date("2099-01-01T00:00:00Z"),
      );

      // Then it never lapses
      expect(entitlement.blockedReason).toBeNull();
    });
  });

  describe("expired or missing license", () => {
    it("should stop new resources from being created once the license lapses", () => {
      // Given a license that expired yesterday
      const mode = {
        kind: "self-hosted" as const,
        license: { ...license, expiresAt: new Date("2026-07-26T00:00:00Z") },
      };

      // When I resolve entitlement
      const entitlement = resolveEntitlement(mode, account, now);

      // Then growth stops, and the operator is told why
      expect(entitlement.blockedReason).toBe(
        "GitLaunch license for Acme Corp expired on 2026-07-26",
      );
    });

    it("should never shrink limits on a lapsed license", () => {
      // Given an expired license on a large install
      const mode = {
        kind: "self-hosted" as const,
        license: { ...license, expiresAt: new Date("2026-07-26T00:00:00Z") },
      };

      // When I resolve entitlement
      const entitlement = resolveEntitlement(mode, account, now);

      // Then everything already running stays within limits — a lapsed licence
      // must never take a customer's production install read-only
      expect(entitlement.limits.maxServices).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlement.billingEnforced).toBe(false);
    });

    it("should block growth on an unlicensed instance", () => {
      // Given someone running the image with no license at all
      const mode = { kind: "self-hosted" as const, license: null };

      // When I resolve entitlement
      const entitlement = resolveEntitlement(mode, account, now);

      // Then they cannot grow the install
      expect(entitlement.blockedReason).toBe(
        "This GitLaunch instance is not licensed",
      );
    });

    it("should still let an unlicensed instance run what it already has", () => {
      // Given an unlicensed instance
      const mode = { kind: "self-hosted" as const, license: null };

      // When I resolve entitlement
      const entitlement = resolveEntitlement(mode, account, now);

      // Then existing services keep deploying — evaluation installs degrade to
      // read-only growth, not a broken product
      expect(entitlement.limits.maxServices).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("should lapse exactly at the expiry instant", () => {
      // Given a license expiring right now
      const mode = {
        kind: "self-hosted" as const,
        license: { ...license, expiresAt: now },
      };

      // When I resolve entitlement at that instant
      const entitlement = resolveEntitlement(mode, account, now);

      // Then it is still honoured — expiry is exclusive
      expect(entitlement.blockedReason).toBeNull();
    });
  });
});
