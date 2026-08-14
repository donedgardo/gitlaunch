// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { describe, it, expect } from "vitest";
import {
  maxAccountsFor,
  resolveEntitlement,
  SelfHostedLicense,
} from "./resolveEntitlement";
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

  const lapsed = {
    kind: "self-hosted" as const,
    license: { ...license, expiresAt: new Date("2026-07-26T00:00:00Z") },
  };

  const unlicensed = { kind: "self-hosted" as const, license: null };

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
      expect(entitlement.licenseNotice).toBeNull();
    });

    it("should never cap how many accounts the hosted product signs up", () => {
      // Given gitlaunch.com, which is multi-tenant by definition
      // When I ask how many accounts this instance may hold
      // Then there is no cap
      expect(maxAccountsFor({ kind: "saas" }, now)).toBe(
        Number.MAX_SAFE_INTEGER,
      );
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
      expect(entitlement.licenseNotice).toBeNull();
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
      expect(entitlement.licenseNotice).toBeNull();
    });

    it("should let a licensed instance host as many accounts as it likes", () => {
      // Given a licensed install
      const mode = { kind: "self-hosted" as const, license };

      // When I ask how many accounts it may hold
      // Then multi-tenancy is what the license bought
      expect(maxAccountsFor(mode, now)).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  // Open core is the FSL product: one account, one seat, everything else
  // unmetered. Running it without a license is a supported configuration, not a
  // violation — so it must be a working install, not a blocked one.
  describe("unlicensed instance running open core", () => {
    it("should meter an unlicensed instance to a single seat", () => {
      // Given someone running the image with no license at all
      // When I resolve entitlement
      const entitlement = resolveEntitlement(unlicensed, account, now);

      // Then seats are the thing that is sold, so there is exactly one
      expect(entitlement.limits.maxUsers).toBe(1);
    });

    it("should hold an unlicensed instance to a single account", () => {
      // Given an unlicensed instance
      // When I ask how many accounts it may hold
      // Then open core is single-tenant
      expect(maxAccountsFor(unlicensed, now)).toBe(1);
    });

    it("should leave everything except seats and accounts unmetered", () => {
      // Given an unlicensed instance
      // When I resolve entitlement
      const entitlement = resolveEntitlement(unlicensed, account, now);

      // Then the open-core product is complete — we sell seats, not capacity
      expect(entitlement.limits.maxRepositories).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlement.limits.maxServices).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlement.limits.maxEnvironments).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlement.limits.publicReposOnly).toBe(false);
    });

    it("should treat running unlicensed as legitimate rather than an error", () => {
      // Given an unlicensed instance
      // When I resolve entitlement
      const entitlement = resolveEntitlement(unlicensed, account, now);

      // Then there is nothing to report — this is a product we ship, and
      // nagging an open-core user is nagging someone using it as intended
      expect(entitlement.licenseNotice).toBeNull();
      expect(entitlement.billingEnforced).toBe(false);
    });
  });

  describe("lapsed license", () => {
    it("should fall back to open core rather than blocking the install", () => {
      // Given a license that expired yesterday
      // When I resolve entitlement
      const entitlement = resolveEntitlement(lapsed, account, now);

      // Then they keep the open-core product — a lapsed renewal must never take
      // a customer's production install read-only, and the FSL grant is theirs
      // whether or not they ever pay us again
      expect(entitlement.limits.maxUsers).toBe(1);
      expect(entitlement.limits.maxServices).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlement.billingEnforced).toBe(false);
    });

    it("should tell the operator why their seats dropped", () => {
      // Given a lapsed license
      // When I resolve entitlement
      const entitlement = resolveEntitlement(lapsed, account, now);

      // Then the reason is available to the boot log and the settings page
      expect(entitlement.licenseNotice).toBe(
        "GitLaunch license for Acme Corp expired on 2026-07-26 — running as open core",
      );
    });

    it("should stop hosting extra accounts once the license lapses", () => {
      // Given a lapsed license
      // When I ask how many accounts the instance may hold
      // Then it is back to single-tenant, though existing accounts are untouched
      expect(maxAccountsFor(lapsed, now)).toBe(1);
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
      expect(entitlement.licenseNotice).toBeNull();
      expect(entitlement.limits.maxUsers).toBe(50);
    });
  });
});
