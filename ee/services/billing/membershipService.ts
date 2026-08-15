// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { Account, Plan } from "../../../src/repositories/accountRepository";

export type CheckoutSessionResult = {
  url: string;
  sessionId: string;
};

export type SubscriptionStatus = {
  status: string;
  currentPeriodEnd: Date;
};

export interface MembershipService {
  createCheckoutSession(params: {
    account: Account;
    userEmail: string | null;
    plan: Plan;
  }): Promise<CheckoutSessionResult>;

  createBillingPortalSession(params: {
    account: Account;
    returnUrl: string;
  }): Promise<{ url: string }>;

  getSubscriptionStatus(account: Account): Promise<SubscriptionStatus | null>;
}
