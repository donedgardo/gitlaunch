import { ObjectId } from "mongodb";
import { Plan, PlanLimits } from "../../repositories/accountRepository";

// What the open core knows about limits and trials.
//
// The open core has to ask two questions — "may this account add another X?"
// and "is there a banner to show?" — without knowing whether the answers come
// from a Stripe plan, a self-hosted license, or nothing at all. These are those
// questions as ports, so the commercial implementations can be removed without
// the dashboard, the API routes or onboarding noticing.
//
// The dependency arrow only points one way: the enterprise code imports these,
// never the reverse. `portability.test.ts` keeps it that way.

export type LimitCheckResult = {
  allowed: boolean;
  reason?: string;
  upgradeRequired?: boolean;
};

export type UsageInfo = {
  repositories: {
    current: number;
    limit: number;
  };
  services: {
    current: number;
    limit: number;
  };
  users: {
    current: number;
    limit: number;
  };
  privateReposAllowed: boolean;
  plan: Plan;
};

export type AccountState = {
  plan: Plan;
  isReadOnly: boolean;
  usage: UsageInfo;
  trialDaysRemaining: number;
  gracePeriodDaysRemaining: number;
  paymentFailed: boolean;
};

export type TrialStartResult =
  | { started: true; trialEndsAt: Date }
  | { started: false; reason: string };

export type TrialExpiryResult = {
  expired: boolean;
  downgraded?: boolean;
};

// Open core: one account, one seat, everything else unmetered. We sell seats and
// tenancy, not capacity — throttling repositories or services would only punish
// someone using the product exactly as licensed.
//
// Defined here rather than in the licensing code because the open core must
// still know its own limits when the licensing code is gone.
export const OPEN_CORE_LIMITS: PlanLimits = {
  maxRepositories: Number.MAX_SAFE_INTEGER,
  maxServices: Number.MAX_SAFE_INTEGER,
  maxUsers: 1,
  maxEnvironments: Number.MAX_SAFE_INTEGER,
  publicReposOnly: false,
};

// Exactly the surface the open core uses. Deliberately narrower than the
// commercial implementation, which also has enforce* throwers and per-resource
// checks that only the enterprise routes call.
export interface AccountLimits {
  getAccountState(accountId: ObjectId): Promise<AccountState>;
  getUsage(accountId: ObjectId): Promise<UsageInfo>;
  canAddService(accountId: ObjectId): Promise<LimitCheckResult>;
  canAddEnvironment(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<LimitCheckResult>;
  canAddPrivateRepository(accountId: ObjectId): Promise<LimitCheckResult>;
}

// Trials are a commercial construct. The open core answers "no trial" to
// everything, which is what makes the banners and the plan picker disappear on
// their own rather than needing to be conditionally compiled out.
export interface TrialPolicy {
  startTrial(
    accountId: ObjectId,
    subject: string,
    plan: Plan,
  ): Promise<TrialStartResult>;
  checkAndHandleTrialExpiry(accountId: ObjectId): Promise<TrialExpiryResult>;
}

export type AccountPolicy = {
  limits: AccountLimits;
  trials: TrialPolicy;
};
