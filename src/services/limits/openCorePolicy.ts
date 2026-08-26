import { ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { MembershipRepository } from "../../repositories/membershipRepository";
import {
  AccountLimits,
  AccountPolicy,
  AccountState,
  LimitCheckResult,
  OPEN_CORE_LIMITS,
  TrialExpiryResult,
  TrialPolicy,
  TrialStartResult,
  UsageInfo,
} from "./accountPolicy";

// The open core's own answers, with no billing and no license behind them.
//
// This exists so that removing the enterprise code leaves a working product
// rather than a hole: the composition root swaps `commercialPolicy` for
// `openCorePolicy` and everything downstream is unchanged.

export type OpenCorePolicyDependencies = {
  accountRepository: AccountRepository;
  repositoryRepository: RepositoryRepository;
  serviceRepository: ServiceRepository;
  membershipRepository: MembershipRepository;
};

export class OpenCoreLimits implements AccountLimits {
  constructor(private deps: OpenCorePolicyDependencies) {}

  async getUsage(accountId: ObjectId): Promise<UsageInfo> {
    const account = await this.deps.accountRepository.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    const [repos, services, memberships] = await Promise.all([
      this.deps.repositoryRepository.findByAccountId(accountId),
      this.deps.serviceRepository.findByAccountId(accountId),
      this.deps.membershipRepository.findByAccountId(accountId),
    ]);

    return {
      repositories: {
        current: repos.length,
        limit: OPEN_CORE_LIMITS.maxRepositories,
      },
      services: {
        current: services.length,
        limit: OPEN_CORE_LIMITS.maxServices,
      },
      users: { current: memberships.length, limit: OPEN_CORE_LIMITS.maxUsers },
      privateReposAllowed: !OPEN_CORE_LIMITS.publicReposOnly,
      plan: account.plan,
    };
  }

  async getAccountState(accountId: ObjectId): Promise<AccountState> {
    const usage = await this.getUsage(accountId);

    // Nothing here can turn an open-core install read-only. There is no invoice
    // to fail and no trial to run out, so the states that would do it cannot
    // arise — and a licensing question must never break a deploy pipeline.
    return {
      plan: usage.plan,
      isReadOnly: false,
      usage,
      trialDaysRemaining: 0,
      gracePeriodDaysRemaining: 0,
      paymentFailed: false,
    };
  }

  async canAddService(): Promise<LimitCheckResult> {
    return { allowed: true };
  }

  async canAddEnvironment(): Promise<LimitCheckResult> {
    return { allowed: true };
  }

  async canAddPrivateRepository(): Promise<LimitCheckResult> {
    return { allowed: true };
  }
}

// Seats are metered — that is the one thing open core withholds — but seat
// checks reach the open core through the enterprise team routes, which are
// absent here. Nothing in the open core adds a second member, so there is no
// seat check to implement on this side.
export const NO_TRIALS: TrialPolicy = {
  async startTrial(): Promise<TrialStartResult> {
    return { started: false, reason: "Trials are not part of open core" };
  },
  async checkAndHandleTrialExpiry(): Promise<TrialExpiryResult> {
    return { expired: false };
  },
};

export function openCorePolicy(
  deps: OpenCorePolicyDependencies,
): AccountPolicy {
  return { limits: new OpenCoreLimits(deps), trials: NO_TRIALS };
}
