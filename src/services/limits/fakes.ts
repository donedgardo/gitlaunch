import { ObjectId } from "mongodb";
import {
  AccountLimits,
  AccountState,
  LimitCheckResult,
  UsageInfo,
} from "./accountPolicy";

/**
 * A stand-in for whatever is answering the `AccountLimits` port — the open-core
 * implementation, a Stripe plan, or a self-hosted license.
 *
 * Routes only ever see the port, so a route test should only ever drive the
 * port. "When limits refuse, the route returns 403" is the core contract; *why*
 * they refused — a plan cap, a failed payment, an expired trial — is commercial
 * policy, and it is covered on that side in
 * `ee/services/billing/planEnforcementService.test.ts`.
 *
 * Reads are delegated so a test still sees real usage numbers; only the answers
 * under test are overridden.
 */
export class FakeAccountLimits implements AccountLimits {
  private readOnly = false;
  private refusals = new Map<keyof AccountLimits, LimitCheckResult>();
  private repositoryLimit?: number;

  constructor(private readonly delegate: AccountLimits) {}

  /** Model an account that billing has put into read-only. */
  markReadOnly(): void {
    this.readOnly = true;
  }

  /**
   * Model a metered repository allowance.
   *
   * Routes that gate on `getUsage()` rather than a `canAdd*` check need a
   * finite number to compare against; open core reports
   * `Number.MAX_SAFE_INTEGER`, which no test can fill.
   */
  setRepositoryLimit(limit: number): void {
    this.repositoryLimit = limit;
  }

  /** Model a limit being hit, whatever the limit happens to be. */
  refuse(check: keyof AccountLimits, result: LimitCheckResult): void {
    this.refusals.set(check, result);
  }

  async getUsage(accountId: ObjectId): Promise<UsageInfo> {
    const usage = await this.delegate.getUsage(accountId);
    if (this.repositoryLimit === undefined) return usage;
    return {
      ...usage,
      repositories: { ...usage.repositories, limit: this.repositoryLimit },
    };
  }

  async getAccountState(accountId: ObjectId): Promise<AccountState> {
    const state = await this.delegate.getAccountState(accountId);
    return { ...state, isReadOnly: this.readOnly };
  }

  async canAddService(accountId: ObjectId): Promise<LimitCheckResult> {
    return (
      this.refusals.get("canAddService") ??
      this.delegate.canAddService(accountId)
    );
  }

  async canAddEnvironment(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<LimitCheckResult> {
    return (
      this.refusals.get("canAddEnvironment") ??
      this.delegate.canAddEnvironment(accountId, serviceId)
    );
  }

  async canAddPrivateRepository(
    accountId: ObjectId,
  ): Promise<LimitCheckResult> {
    return (
      this.refusals.get("canAddPrivateRepository") ??
      this.delegate.canAddPrivateRepository(accountId)
    );
  }
}
