import { Account } from "../../repositories/accountRepository";

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
  }): Promise<CheckoutSessionResult>;

  createBillingPortalSession(params: {
    account: Account;
    returnUrl: string;
  }): Promise<{ url: string }>;

  getSubscriptionStatus(account: Account): Promise<SubscriptionStatus | null>;
}
