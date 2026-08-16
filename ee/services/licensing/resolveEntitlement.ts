// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { Plan, PlanLimits } from "../../../src/repositories/accountRepository";
import { OPEN_CORE_LIMITS } from "../../../src/services/limits/accountPolicy";

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
  // Something the operator should know about their license — today, only that it
  // lapsed. Informational: it never blocks anything on its own.
  licenseNotice: string | null;
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

// Open core's limits are defined in the open core itself — see
// services/limits/accountPolicy.ts. The licensing code reads them so that both
// sides agree on what "unlicensed" means, and so removing this file does not
// take the definition of the free product with it.
export { OPEN_CORE_LIMITS };

// Whether this instance is running the free open-core product rather than
// something we sold. True for a self-hosted install with no license, and for
// one whose license has lapsed — expiry returns a customer to open core, it
// does not strip them of the FSL grant, which was never ours to withdraw.
export function isOpenCore(mode: InstanceMode, now: Date): boolean {
  if (mode.kind === "saas") return false;
  return !mode.license || hasExpired(mode.license, now);
}

// How many accounts this *instance* may hold. Instance-wide rather than
// per-account, so it does not belong in PlanLimits, which is persisted on each
// account record.
export function maxAccountsFor(mode: InstanceMode, now: Date): number {
  return isOpenCore(mode, now) ? 1 : Number.MAX_SAFE_INTEGER;
}

export function resolveEntitlement(
  mode: InstanceMode,
  account: { plan: Plan; planLimits: PlanLimits },
  now: Date,
): Entitlement {
  if (mode.kind === "saas") {
    return {
      limits: account.planLimits,
      billingEnforced: true,
      licenseNotice: null,
    };
  }

  // Self-hosted from here down. Capacity stays unmetered in every branch —
  // revoking it would take a customer's production install read-only, and a
  // licensing disagreement must never be able to break a running deployment
  // pipeline. What a license buys is seats and tenancy, so that is all that
  // moves between open core and a sold install.
  if (isOpenCore(mode, now)) {
    return {
      limits: OPEN_CORE_LIMITS,
      billingEnforced: false,
      licenseNotice: lapseNotice(mode.license, now),
    };
  }

  return {
    limits: {
      ...UNMETERED,
      maxUsers: mode.license?.maxUsers ?? UNMETERED.maxUsers,
    },
    billingEnforced: false,
    licenseNotice: null,
  };
}

// Expiry is exclusive — a license is honoured through its final instant.
function hasExpired(license: SelfHostedLicense, now: Date): boolean {
  return !!license.expiresAt && license.expiresAt.getTime() < now.getTime();
}

// Only a customer whose license lapsed gets told anything. Running unlicensed
// is a supported configuration, and nagging someone using open core as intended
// would be nagging them for doing nothing wrong.
function lapseNotice(
  license: SelfHostedLicense | null,
  now: Date,
): string | null {
  if (!license || !hasExpired(license, now)) return null;
  const on = license.expiresAt!.toISOString().slice(0, 10);
  return `GitLaunch license for ${license.licensedTo} expired on ${on} — running as open core`;
}
