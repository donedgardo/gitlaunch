import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { AccountRepository, Plan } from "../../repositories/accountRepository";
import { StripeWebhookHandler } from "./webhookHandler";

describe("StripeWebhookHandler", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let handler: StripeWebhookHandler;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    handler = new StripeWebhookHandler(accountRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
  });

  describe("handleCheckoutCompleted", () => {
    it("should upgrade account to paid plan on successful checkout", async () => {
      // Given: a free account
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      expect(account.plan).toBe(Plan.Free);

      // When: checkout is completed
      await handler.handleCheckoutCompleted({
        accountId: account._id.toString(),
        customerId: "cus_test123",
        subscriptionId: "sub_test123",
      });

      // Then: account is upgraded to paid
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Paid);
      expect(updated!.stripeCustomerId).toBe("cus_test123");
      expect(updated!.stripeSubscriptionId).toBe("sub_test123");
    });

    it("should update plan limits to paid tier", async () => {
      // Given: a free account with free limits
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-2",
      });
      expect(account.planLimits.maxRepositories).toBe(1);

      // When: checkout is completed
      await handler.handleCheckoutCompleted({
        accountId: account._id.toString(),
        customerId: "cus_test456",
        subscriptionId: "sub_test456",
      });

      // Then: limits are upgraded
      const updated = await accountRepo.findById(account._id);
      expect(updated!.planLimits.maxRepositories).toBe(5);
      expect(updated!.planLimits.maxUsers).toBe(5);
      expect(updated!.planLimits.publicReposOnly).toBe(false);
    });
  });

  describe("handleSubscriptionDeleted", () => {
    it("should downgrade account to free plan on cancellation", async () => {
      // Given: a paid account
      const account = await accountRepo.create({
        name: "Paid Org",
        slug: "paid-org",
      });
      await handler.handleCheckoutCompleted({
        accountId: account._id.toString(),
        customerId: "cus_paid",
        subscriptionId: "sub_paid",
      });
      const paidAccount = await accountRepo.findById(account._id);
      expect(paidAccount!.plan).toBe(Plan.Paid);

      // When: subscription is cancelled
      await handler.handleSubscriptionDeleted({
        subscriptionId: "sub_paid",
      });

      // Then: account is downgraded to free
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Free);
      expect(updated!.stripeSubscriptionId).toBeNull();
    });

    it("should reset plan limits to free tier", async () => {
      // Given: a paid account
      const account = await accountRepo.create({
        name: "Downgrade Org",
        slug: "downgrade-org",
      });
      await handler.handleCheckoutCompleted({
        accountId: account._id.toString(),
        customerId: "cus_downgrade",
        subscriptionId: "sub_downgrade",
      });

      // When: subscription is cancelled
      await handler.handleSubscriptionDeleted({
        subscriptionId: "sub_downgrade",
      });

      // Then: limits are reset
      const updated = await accountRepo.findById(account._id);
      expect(updated!.planLimits.maxRepositories).toBe(1);
      expect(updated!.planLimits.maxUsers).toBe(1);
      expect(updated!.planLimits.publicReposOnly).toBe(true);
    });
  });

  describe("handlePaymentFailed", () => {
    it("should mark account with payment failure status", async () => {
      // Given: a paid account
      const account = await accountRepo.create({
        name: "Failing Org",
        slug: "failing-org",
      });
      await handler.handleCheckoutCompleted({
        accountId: account._id.toString(),
        customerId: "cus_failing",
        subscriptionId: "sub_failing",
      });

      // When: payment fails
      await handler.handlePaymentFailed({
        subscriptionId: "sub_failing",
        attemptCount: 1,
      });

      // Then: account has payment failure flag
      const updated = await accountRepo.findById(account._id);
      expect(updated!.paymentFailedAt).toBeDefined();
      expect(updated!.paymentFailedAt).toBeInstanceOf(Date);
    });

    it("should keep paid plan during grace period", async () => {
      // Given: a paid account
      const account = await accountRepo.create({
        name: "Grace Org",
        slug: "grace-org",
      });
      await handler.handleCheckoutCompleted({
        accountId: account._id.toString(),
        customerId: "cus_grace",
        subscriptionId: "sub_grace",
      });

      // When: payment fails (first attempt)
      await handler.handlePaymentFailed({
        subscriptionId: "sub_grace",
        attemptCount: 1,
      });

      // Then: account is still paid (grace period)
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Paid);
    });
  });

  describe("handlePaymentSucceeded", () => {
    it("should clear payment failure status on successful payment", async () => {
      // Given: an account with payment failure
      const account = await accountRepo.create({
        name: "Recovery Org",
        slug: "recovery-org",
      });
      await handler.handleCheckoutCompleted({
        accountId: account._id.toString(),
        customerId: "cus_recovery",
        subscriptionId: "sub_recovery",
      });
      await handler.handlePaymentFailed({
        subscriptionId: "sub_recovery",
        attemptCount: 1,
      });
      const failedAccount = await accountRepo.findById(account._id);
      expect(failedAccount!.paymentFailedAt).toBeDefined();

      // When: payment succeeds
      await handler.handlePaymentSucceeded({
        subscriptionId: "sub_recovery",
      });

      // Then: payment failure is cleared
      const updated = await accountRepo.findById(account._id);
      expect(updated!.paymentFailedAt).toBeNull();
    });
  });
});
