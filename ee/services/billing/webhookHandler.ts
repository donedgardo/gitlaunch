// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { ObjectId } from "mongodb";
import {
  AccountRepository,
  Plan,
} from "../../../src/repositories/accountRepository";

export type CheckoutCompletedEvent = {
  accountId: string;
  customerId: string;
  subscriptionId: string;
  plan: Plan;
};

export type SubscriptionDeletedEvent = {
  subscriptionId: string;
};

export type PaymentFailedEvent = {
  subscriptionId: string;
  attemptCount: number;
};

export type PaymentSucceededEvent = {
  subscriptionId: string;
};

export class StripeWebhookHandler {
  constructor(private accountRepo: AccountRepository) {}

  async handleCheckoutCompleted(event: CheckoutCompletedEvent): Promise<void> {
    const accountId = new ObjectId(event.accountId);
    await this.accountRepo.upgradeToPlan(
      accountId,
      event.customerId,
      event.subscriptionId,
      event.plan,
    );
  }

  async handleSubscriptionDeleted(
    event: SubscriptionDeletedEvent,
  ): Promise<void> {
    const account = await this.accountRepo.findBySubscriptionId(
      event.subscriptionId,
    );
    if (account) {
      await this.accountRepo.downgradeToFree(account._id);
    }
  }

  async handlePaymentFailed(event: PaymentFailedEvent): Promise<void> {
    const account = await this.accountRepo.findBySubscriptionId(
      event.subscriptionId,
    );
    if (account) {
      await this.accountRepo.setPaymentFailed(account._id);
    }
  }

  async handlePaymentSucceeded(event: PaymentSucceededEvent): Promise<void> {
    const account = await this.accountRepo.findBySubscriptionId(
      event.subscriptionId,
    );
    if (account) {
      await this.accountRepo.clearPaymentFailed(account._id);
    }
  }
}
