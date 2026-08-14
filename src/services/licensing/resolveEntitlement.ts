// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { Plan, PlanLimits } from "../../repositories/accountRepository";

// Entitlement answers one question: what may this account do *on this
// instance*? On gitlaunch.com the answer comes from the plan the customer pays
// Stripe for. On a self-hosted install there is no Stripe — the customer bought
// the software, so the license they were issued is the authority instead.

export type SelfHostedLicense = {
  licensedTo: string;
  // Seats sold; null for a site license with no cap.
  maxUsers: number | null;
  // null for a perpetual license.
  expiresAt: Date | null;
};

export type InstanceMode =
  | { kind: "saas" }
  | { kind: "self-hosted"; license: SelfHostedLicense | null };

export type Entitlement = {
  limits: PlanLimits;
  // Whether Stripe governs this account. False self-hosted, which is what keeps
  // trial countdowns and payment-failure read-only off a customer's own install.
  billingEnforced: boolean;
  // Set when the instance may not create new resources — an unlicensed or
  // lapsed install. Existing resources are deliberately untouched.
  blockedReason: string | null;
};

// A self-hosted customer bought the software; per-resource SaaS tiers are not
// what they paid for, so nothing but seats is metered.
const UNMETERED: PlanLimits = {
  maxRepositories: Number.MAX_SAFE_INTEGER,
  maxServices: Number.MAX_SAFE_INTEGER,
  maxUsers: Number.MAX_SAFE_INTEGER,
  maxEnvironments: Number.MAX_SAFE_INTEGER,
  publicReposOnly: false,
};

export function resolveEntitlement(
  mode: InstanceMode,
  account: { plan: Plan; planLimits: PlanLimits },
  now: Date,
): Entitlement {
  if (mode.kind === "saas") {
    return {
      limits: account.planLimits,
      billingEnforced: true,
      blockedReason: null,
    };
  }

  // Self-hosted from here down. Limits stay unmetered in every branch,
  // including unlicensed and lapsed: revoking capacity would take a customer's
  // production install read-only, and a licensing disagreement must never be
  // able to break a running deployment pipeline. Enforcement is on *growth*
  // only, via blockedReason.
  const limits: PlanLimits = {
    ...UNMETERED,
    maxUsers: mode.license?.maxUsers ?? UNMETERED.maxUsers,
  };

  return {
    limits,
    billingEnforced: false,
    blockedReason: licenseBlock(mode.license, now),
  };
}

function licenseBlock(
  license: SelfHostedLicense | null,
  now: Date,
): string | null {
  if (!license) {
    return "This GitLaunch instance is not licensed";
  }
  // Expiry is exclusive — a license is honoured through its final instant.
  if (license.expiresAt && license.expiresAt.getTime() < now.getTime()) {
    const on = license.expiresAt.toISOString().slice(0, 10);
    return `GitLaunch license for ${license.licensedTo} expired on ${on}`;
  }
  return null;
}
