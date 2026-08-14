// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { ObjectId } from "mongodb";
import {
  AccountRepository,
  Plan,
  Account,
} from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { MembershipRepository } from "../../repositories/membershipRepository";
import {
  Entitlement,
  InstanceMode,
  resolveEntitlement,
} from "../licensing/resolveEntitlement";

export class PlanLimitError extends Error {
  constructor(
    message: string,
    public readonly upgradeRequired: boolean = true,
  ) {
    super(message);
    this.name = "PlanLimitError";
  }
}

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

export const GRACE_PERIOD_DAYS = 7;

export class PlanEnforcementService {
  constructor(
    private accountRepo: AccountRepository,
    private repoRepo: RepositoryRepository,
    private serviceRepo: ServiceRepository,
    private membershipRepo: MembershipRepository,
    // Which instance this is. Defaults to the hosted SaaS, so gitlaunch.com
    // behaves exactly as before; a self-hosted install passes its license here.
    private instanceMode: InstanceMode = { kind: "saas" },
  ) {}

  // What this account may do *on this instance* — the plan it pays Stripe for
  // on SaaS, the license the customer bought on a self-hosted install.
  private entitlementFor(account: Account): Entitlement {
    return resolveEntitlement(this.instanceMode, account, new Date());
  }

  async canAddRepository(accountId: ObjectId): Promise<LimitCheckResult> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      return { allowed: false, reason: "Account not found" };
    }

    const entitlement = this.entitlementFor(account);

    const repos = await this.repoRepo.findByAccountId(accountId);
    const currentCount = repos.length;
    const limit = entitlement.limits.maxRepositories;

    if (currentCount >= limit) {
      return {
        allowed: false,
        reason: `Repository limit reached (${currentCount}/${limit}). Upgrade to add more repositories.`,
        upgradeRequired: true,
      };
    }

    return { allowed: true };
  }

  async canAddPrivateRepository(
    accountId: ObjectId,
  ): Promise<LimitCheckResult> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      return { allowed: false, reason: "Account not found" };
    }

    const entitlement = this.entitlementFor(account);

    if (entitlement.limits.publicReposOnly) {
      return {
        allowed: false,
        reason:
          "Private repositories require a paid plan. Upgrade to connect private repositories.",
        upgradeRequired: true,
      };
    }

    return { allowed: true };
  }

  async canAddUser(accountId: ObjectId): Promise<LimitCheckResult> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      return { allowed: false, reason: "Account not found" };
    }

    const entitlement = this.entitlementFor(account);

    const memberships = await this.membershipRepo.findByAccountId(accountId);
    const currentCount = memberships.length;
    const limit = entitlement.limits.maxUsers;

    if (currentCount >= limit) {
      // A seat limit on a self-hosted install is not an upsell: there is no
      // Stripe plan to buy, so point the operator at their license instead of
      // showing them a checkout CTA that goes nowhere.
      return entitlement.billingEnforced
        ? {
            allowed: false,
            reason: `User limit reached (${currentCount}/${limit}). Upgrade to add more team members.`,
            upgradeRequired: true,
          }
        : {
            allowed: false,
            reason: `Seat limit reached (${currentCount}/${limit}). Additional seats require a GitLaunch license.`,
            upgradeRequired: false,
          };
    }

    return { allowed: true };
  }

  async canAddService(accountId: ObjectId): Promise<LimitCheckResult> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      return { allowed: false, reason: "Account not found" };
    }

    const entitlement = this.entitlementFor(account);

    const services = await this.serviceRepo.findByAccountId(accountId);
    const currentCount = services.length;
    const limit = entitlement.limits.maxServices;

    if (currentCount >= limit) {
      return {
        allowed: false,
        reason: `Service limit reached (${currentCount}/${limit}). Upgrade to add more services.`,
        upgradeRequired: true,
      };
    }

    return { allowed: true };
  }

  async canAddEnvironment(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<LimitCheckResult> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      return { allowed: false, reason: "Account not found" };
    }

    const service = await this.serviceRepo.findById(serviceId);
    if (!service || !service.accountId.equals(accountId)) {
      return { allowed: false, reason: "Service not found" };
    }

    const entitlement = this.entitlementFor(account);

    const currentCount = service.environments.length;
    const limit = entitlement.limits.maxEnvironments;

    if (currentCount >= limit) {
      return {
        allowed: false,
        reason: `Environment limit reached (${currentCount}/${limit}). Upgrade to add more environments.`,
        upgradeRequired: true,
      };
    }

    return { allowed: true };
  }

  async getUsage(accountId: ObjectId): Promise<UsageInfo> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    const entitlement = this.entitlementFor(account);
    const repos = await this.repoRepo.findByAccountId(accountId);
    const services = await this.serviceRepo.findByAccountId(accountId);
    const memberships = await this.membershipRepo.findByAccountId(accountId);

    return {
      repositories: {
        current: repos.length,
        limit: entitlement.limits.maxRepositories,
      },
      services: {
        current: services.length,
        limit: entitlement.limits.maxServices,
      },
      users: {
        current: memberships.length,
        limit: entitlement.limits.maxUsers,
      },
      privateReposAllowed: !entitlement.limits.publicReposOnly,
      plan: account.plan,
    };
  }

  async enforceRepositoryLimit(accountId: ObjectId): Promise<void> {
    const result = await this.canAddRepository(accountId);
    if (!result.allowed) {
      throw new PlanLimitError(
        result.reason || "Repository limit exceeded",
        result.upgradeRequired,
      );
    }
  }

  async enforcePrivateRepoLimit(accountId: ObjectId): Promise<void> {
    const result = await this.canAddPrivateRepository(accountId);
    if (!result.allowed) {
      throw new PlanLimitError(
        result.reason || "Private repositories not allowed",
        result.upgradeRequired,
      );
    }
  }

  async enforceUserLimit(accountId: ObjectId): Promise<void> {
    const result = await this.canAddUser(accountId);
    if (!result.allowed) {
      throw new PlanLimitError(
        result.reason || "User limit exceeded",
        result.upgradeRequired,
      );
    }
  }

  async enforceServiceLimit(accountId: ObjectId): Promise<void> {
    const result = await this.canAddService(accountId);
    if (!result.allowed) {
      throw new PlanLimitError(
        result.reason || "Service limit exceeded",
        result.upgradeRequired,
      );
    }
  }

  async enforceEnvironmentLimit(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<void> {
    const result = await this.canAddEnvironment(accountId, serviceId);
    if (!result.allowed) {
      throw new PlanLimitError(
        result.reason || "Environment limit exceeded",
        result.upgradeRequired,
      );
    }
  }

  isInGracePeriod(account: Account | null): boolean {
    if (!account || !account.paymentFailedAt) {
      return false;
    }

    const gracePeriodEnd =
      account.paymentFailedAt.getTime() +
      GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
    return gracePeriodEnd > Date.now();
  }

  getGracePeriodDaysRemaining(account: Account | null): number {
    if (!account || !account.paymentFailedAt) {
      return 0;
    }

    const gracePeriodEnd =
      account.paymentFailedAt.getTime() +
      GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
    const msRemaining = gracePeriodEnd - Date.now();

    if (msRemaining <= 0) {
      return 0;
    }

    return Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
  }

  async getAccountState(accountId: ObjectId): Promise<AccountState> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    const usage = await this.getUsage(accountId);

    // Check payment failure and grace period. Only meaningful where Stripe
    // governs the account — a self-hosted install has no way to settle an
    // invoice, so stale payment state must never restrict it.
    const entitlement = this.entitlementFor(account);
    const paymentFailed =
      entitlement.billingEnforced && !!account.paymentFailedAt;
    const inGracePeriod = this.isInGracePeriod(account);
    const gracePeriodDaysRemaining = this.getGracePeriodDaysRemaining(account);

    // Compute isReadOnly: true when:
    // 1. Exceeding repo or service limits, OR
    // 2. Payment failed AND grace period has expired (not in grace period)
    const isReadOnly =
      usage.repositories.current > usage.repositories.limit ||
      usage.services.current > usage.services.limit ||
      (paymentFailed && !inGracePeriod);

    // Compute trial days remaining
    let trialDaysRemaining = 0;
    if (account.trialEndsAt) {
      const now = Date.now();
      const trialEnd = account.trialEndsAt.getTime();
      if (trialEnd > now) {
        trialDaysRemaining = Math.ceil(
          (trialEnd - now) / (24 * 60 * 60 * 1000),
        );
      }
    }

    return {
      plan: account.plan,
      isReadOnly,
      usage,
      trialDaysRemaining,
      gracePeriodDaysRemaining,
      paymentFailed,
    };
  }
}
