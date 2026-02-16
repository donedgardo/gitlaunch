import { ObjectId } from "mongodb";
import { AccountRepository, Plan } from "../../repositories/accountRepository";
import { TrialRegistryRepository } from "../../repositories/trialRegistryRepository";

const TRIAL_DURATION_DAYS = 14;

export type TrialStartResult =
  | { started: true; trialEndsAt: Date }
  | { started: false; reason: string };

export type TrialStatus =
  | { onTrial: false; expired?: boolean }
  | { onTrial: true; daysRemaining: number; trialEndsAt: Date };

export type TrialExpiryResult = {
  expired: boolean;
  downgraded?: boolean;
};

export class TrialService {
  constructor(
    private accountRepo: AccountRepository,
    private trialRegistryRepo: TrialRegistryRepository,
    private clock: { now: () => Date } = { now: () => new Date() },
  ) {}

  async startTrial(
    accountId: ObjectId,
    githubId: number,
    plan: Plan,
  ): Promise<TrialStartResult> {
    // Validate plan is Pro or Team (not Free)
    if (plan === Plan.Free) {
      return { started: false, reason: "Cannot start trial on Free plan" };
    }

    // Try to claim trial in registry (atomic duplicate check)
    const claimed = await this.trialRegistryRepo.claimTrial(
      githubId,
      accountId,
    );

    if (!claimed) {
      return { started: false, reason: "Trial already used" };
    }

    // Calculate trial end date (14 days from now)
    const trialEndsAt = new Date(
      this.clock.now().getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
    );

    // Update account with plan and trial end date
    await this.accountRepo.selectPlan(accountId, plan);
    await this.accountRepo.setTrialEndsAt(accountId, trialEndsAt);

    return { started: true, trialEndsAt };
  }

  async getTrialStatus(accountId: ObjectId): Promise<TrialStatus> {
    const account = await this.accountRepo.findById(accountId);

    if (!account || !account.trialEndsAt) {
      return { onTrial: false };
    }

    const now = this.clock.now().getTime();
    const trialEnd = account.trialEndsAt.getTime();

    if (trialEnd < now) {
      return { onTrial: false, expired: true };
    }

    const daysRemaining = Math.floor((trialEnd - now) / (24 * 60 * 60 * 1000));

    return {
      onTrial: true,
      daysRemaining,
      trialEndsAt: account.trialEndsAt,
    };
  }

  async checkAndHandleTrialExpiry(
    accountId: ObjectId,
  ): Promise<TrialExpiryResult> {
    const account = await this.accountRepo.findById(accountId);

    // No trial set - not expired
    if (!account || !account.trialEndsAt) {
      return { expired: false };
    }

    const now = this.clock.now().getTime();
    const trialEnd = account.trialEndsAt.getTime();

    // Trial still active - not expired
    if (trialEnd >= now) {
      return { expired: false };
    }

    // Trial expired but user subscribed during trial - clear stale trialEndsAt
    if (account.stripeSubscriptionId) {
      await this.accountRepo.setTrialEndsAt(accountId, null);
      return { expired: false };
    }

    // Trial expired with no subscription - downgrade to Free
    await this.accountRepo.downgradeToFree(accountId);
    await this.accountRepo.setTrialEndsAt(accountId, null);
    return { expired: true, downgraded: true };
  }
}
