import { ObjectId } from "mongodb";
import { AccountRepository, Plan } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { MembershipRepository } from "../../repositories/membershipRepository";

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

export class PlanEnforcementService {
  constructor(
    private accountRepo: AccountRepository,
    private repoRepo: RepositoryRepository,
    private serviceRepo: ServiceRepository,
    private membershipRepo: MembershipRepository,
  ) {}

  async canAddRepository(accountId: ObjectId): Promise<LimitCheckResult> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      return { allowed: false, reason: "Account not found" };
    }

    const repos = await this.repoRepo.findByAccountId(accountId);
    const currentCount = repos.length;
    const limit = account.planLimits.maxRepositories;

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

    if (account.planLimits.publicReposOnly) {
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

    const memberships = await this.membershipRepo.findByAccountId(accountId);
    const currentCount = memberships.length;
    const limit = account.planLimits.maxUsers;

    if (currentCount >= limit) {
      return {
        allowed: false,
        reason: `User limit reached (${currentCount}/${limit}). Upgrade to add more team members.`,
        upgradeRequired: true,
      };
    }

    return { allowed: true };
  }

  async canAddService(accountId: ObjectId): Promise<LimitCheckResult> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      return { allowed: false, reason: "Account not found" };
    }

    const services = await this.serviceRepo.findByAccountId(accountId);
    const currentCount = services.length;
    const limit = account.planLimits.maxServices;

    if (currentCount >= limit) {
      return {
        allowed: false,
        reason: `Service limit reached (${currentCount}/${limit}). Upgrade to add more services.`,
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

    const repos = await this.repoRepo.findByAccountId(accountId);
    const services = await this.serviceRepo.findByAccountId(accountId);
    const memberships = await this.membershipRepo.findByAccountId(accountId);

    return {
      repositories: {
        current: repos.length,
        limit: account.planLimits.maxRepositories,
      },
      services: {
        current: services.length,
        limit: account.planLimits.maxServices,
      },
      users: {
        current: memberships.length,
        limit: account.planLimits.maxUsers,
      },
      privateReposAllowed: !account.planLimits.publicReposOnly,
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
}
