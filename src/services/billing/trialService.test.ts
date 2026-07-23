import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { TrialService } from "./trialService";
import { AccountRepository, Plan } from "../../repositories/accountRepository";
import { TrialRegistryRepository } from "../../repositories/trialRegistryRepository";

describe("TrialService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let trialRegistryRepo: TrialRegistryRepository;
  let trialService: TrialService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    trialRegistryRepo = new TrialRegistryRepository(db);
    await trialRegistryRepo.ensureIndexes();
    trialService = new TrialService(accountRepo, trialRegistryRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clean up between tests
    await db.collection("accounts").deleteMany({});
    await db.collection("trialRegistry").deleteMany({});
  });

  describe("startTrial", () => {
    it("should reject trial start for Free plan", async () => {
      // Given: an account exists
      const account = await accountRepo.create({
        name: "Free User",
        slug: "free-user",
      });
      const subject = "github:12345";

      // When: I try to start a trial for Free plan
      const result = await trialService.startTrial(
        account._id,
        subject,
        Plan.Free,
      );

      // Then: the trial is rejected
      expect(result.started).toBe(false);
      if (!result.started) {
        expect(result.reason).toBe("Cannot start trial on Free plan");
      }
    });

    it("should start trial for Pro plan with first-time GitHub user", async () => {
      // Given: an account exists and GitHub user never claimed trial
      const account = await accountRepo.create({
        name: "Pro User",
        slug: "pro-user",
      });
      const subject = "github:67890";

      // When: I start a trial for Pro plan
      const result = await trialService.startTrial(
        account._id,
        subject,
        Plan.Pro,
      );

      // Then: the trial starts successfully
      expect(result.started).toBe(true);
      if (result.started) {
        expect(result.trialEndsAt).toBeDefined();

        // And: the account is updated with Pro plan and trial end date
        const updated = await accountRepo.findById(account._id);
        expect(updated?.plan).toBe(Plan.Pro);
        expect(updated?.trialEndsAt).not.toBeNull();
        expect(updated?.trialEndsAt?.getTime()).toBe(
          result.trialEndsAt.getTime(),
        );
      }
    });

    it("should start trial for Team plan with first-time GitHub user", async () => {
      // Given: an account exists and GitHub user never claimed trial
      const account = await accountRepo.create({
        name: "Team User",
        slug: "team-user",
      });
      const subject = "github:11111";

      // When: I start a trial for Team plan
      const result = await trialService.startTrial(
        account._id,
        subject,
        Plan.Team,
      );

      // Then: the trial starts successfully
      expect(result.started).toBe(true);
      if (result.started) {
        expect(result.trialEndsAt).toBeDefined();

        // And: the account is updated with Team plan and trial end date
        const updated = await accountRepo.findById(account._id);
        expect(updated?.plan).toBe(Plan.Team);
        expect(updated?.trialEndsAt).not.toBeNull();
      }
    });

    it("should set trial end date to 14 days from now", async () => {
      // Given: an account exists
      const account = await accountRepo.create({
        name: "Date Check",
        slug: "date-check",
      });
      const subject = "github:22222";

      // When: I start a trial
      const beforeStart = Date.now();
      const result = await trialService.startTrial(
        account._id,
        subject,
        Plan.Pro,
      );
      const afterStart = Date.now();

      // Then: trial ends 14 days from now (with small tolerance for test execution time)
      expect(result.started).toBe(true);
      if (result.started) {
        const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
        const expectedMin = beforeStart + fourteenDaysMs;
        const expectedMax = afterStart + fourteenDaysMs;
        expect(result.trialEndsAt.getTime()).toBeGreaterThanOrEqual(
          expectedMin,
        );
        expect(result.trialEndsAt.getTime()).toBeLessThanOrEqual(expectedMax);
      }
    });

    it("should reject trial start when GitHub user already claimed trial on same account", async () => {
      // Given: a GitHub user already claimed a trial on this account
      const account = await accountRepo.create({
        name: "Same Account",
        slug: "same-account",
      });
      const subject = "github:33333";
      await trialService.startTrial(account._id, subject, Plan.Pro);

      // When: the same user tries to start another trial on the same account
      const result = await trialService.startTrial(
        account._id,
        subject,
        Plan.Pro,
      );

      // Then: the trial is rejected
      expect(result.started).toBe(false);
      if (!result.started) {
        expect(result.reason).toBe("Trial already used");
      }
    });

    it("should reject trial start when GitHub user already claimed trial on different account", async () => {
      // Given: a GitHub user already claimed a trial on one account
      const account1 = await accountRepo.create({
        name: "First Account",
        slug: "first-account",
      });
      const subject = "github:44444";
      await trialService.startTrial(account1._id, subject, Plan.Pro);

      // When: the same user tries to start a trial on a different account
      const account2 = await accountRepo.create({
        name: "Second Account",
        slug: "second-account",
      });
      const result = await trialService.startTrial(
        account2._id,
        subject,
        Plan.Pro,
      );

      // Then: the trial is rejected (one trial per GitHub user)
      expect(result.started).toBe(false);
      if (!result.started) {
        expect(result.reason).toBe("Trial already used");
      }
    });
  });

  describe("getTrialStatus", () => {
    it("should return onTrial false when trialEndsAt is null", async () => {
      // Given: an account with no trial
      const account = await accountRepo.create({
        name: "No Trial",
        slug: "no-trial",
      });

      // When: I check trial status
      const status = await trialService.getTrialStatus(account._id);

      // Then: onTrial is false
      expect(status.onTrial).toBe(false);
      if (!status.onTrial) {
        expect(status.expired).toBeUndefined();
      }
    });

    it("should return onTrial true with days remaining when trial is active", async () => {
      // Given: an account with an active trial (14 days from now)
      const account = await accountRepo.create({
        name: "Active Trial",
        slug: "active-trial",
      });
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await accountRepo.setTrialEndsAt(account._id, trialEndsAt);

      // When: I check trial status
      const status = await trialService.getTrialStatus(account._id);

      // Then: onTrial is true with days remaining
      expect(status.onTrial).toBe(true);
      if (status.onTrial) {
        expect(status.daysRemaining).toBeGreaterThanOrEqual(13);
        expect(status.daysRemaining).toBeLessThanOrEqual(14);
        expect(status.trialEndsAt.getTime()).toBe(trialEndsAt.getTime());
      }
    });

    it("should return onTrial false with expired true when trial ended", async () => {
      // Given: an account with an expired trial (1 day ago)
      const account = await accountRepo.create({
        name: "Expired Trial",
        slug: "expired-trial",
      });
      const trialEndsAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await accountRepo.setTrialEndsAt(account._id, trialEndsAt);

      // When: I check trial status
      const status = await trialService.getTrialStatus(account._id);

      // Then: onTrial is false and expired is true
      expect(status.onTrial).toBe(false);
      if (!status.onTrial) {
        expect(status.expired).toBe(true);
      }
    });

    it("should calculate days remaining correctly for partial days", async () => {
      // Given: an account with trial ending in ~13.5 days
      const account = await accountRepo.create({
        name: "Partial Days",
        slug: "partial-days",
      });
      const trialEndsAt = new Date(Date.now() + 13.5 * 24 * 60 * 60 * 1000);
      await accountRepo.setTrialEndsAt(account._id, trialEndsAt);

      // When: I check trial status
      const status = await trialService.getTrialStatus(account._id);

      // Then: daysRemaining is 13 (rounded down)
      expect(status.onTrial).toBe(true);
      if (status.onTrial) {
        expect(status.daysRemaining).toBe(13);
      }
    });
  });

  describe("checkAndHandleTrialExpiry", () => {
    it("should return expired false when account has no trial", async () => {
      // Given: an account with no trial
      const account = await accountRepo.create({
        name: "No Trial",
        slug: "no-trial",
      });

      // When: I check and handle trial expiry
      const result = await trialService.checkAndHandleTrialExpiry(account._id);

      // Then: expired is false
      expect(result.expired).toBe(false);
      expect(result.downgraded).toBeUndefined();
    });

    it("should return expired false when trial is still active", async () => {
      // Given: an account with active trial (5 days remaining)
      const account = await accountRepo.create({
        name: "Active Trial",
        slug: "active-trial",
      });
      const trialEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await accountRepo.setTrialEndsAt(account._id, trialEndsAt);
      await accountRepo.selectPlan(account._id, Plan.Pro);

      // When: I check and handle trial expiry
      const result = await trialService.checkAndHandleTrialExpiry(account._id);

      // Then: expired is false, account unchanged
      expect(result.expired).toBe(false);
      const updated = await accountRepo.findById(account._id);
      expect(updated?.plan).toBe(Plan.Pro);
      expect(updated?.trialEndsAt?.getTime()).toBe(trialEndsAt.getTime());
    });

    it("should downgrade to Free when trial expired with no subscription", async () => {
      // Given: an account with expired trial and no subscription
      const account = await accountRepo.create({
        name: "Expired Trial",
        slug: "expired-trial",
      });
      const trialEndsAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      await accountRepo.setTrialEndsAt(account._id, trialEndsAt);
      await accountRepo.selectPlan(account._id, Plan.Pro);

      // When: I check and handle trial expiry
      const result = await trialService.checkAndHandleTrialExpiry(account._id);

      // Then: expired is true, downgraded is true
      expect(result.expired).toBe(true);
      expect(result.downgraded).toBe(true);

      // And: account is downgraded to Free with trialEndsAt cleared
      const updated = await accountRepo.findById(account._id);
      expect(updated?.plan).toBe(Plan.Free);
      expect(updated?.trialEndsAt).toBeNull();
    });

    it("should clear stale trialEndsAt when trial expired but subscription exists", async () => {
      // Given: an account with expired trial BUT has a subscription
      const account = await accountRepo.create({
        name: "Subscribed During Trial",
        slug: "subscribed-during-trial",
      });
      const trialEndsAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      await accountRepo.setTrialEndsAt(account._id, trialEndsAt);
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_123",
        "sub_123",
        Plan.Pro,
      );

      // When: I check and handle trial expiry
      const result = await trialService.checkAndHandleTrialExpiry(account._id);

      // Then: expired is false (user subscribed, so no downgrade)
      expect(result.expired).toBe(false);
      expect(result.downgraded).toBeUndefined();

      // And: stale trialEndsAt is cleared
      const updated = await accountRepo.findById(account._id);
      expect(updated?.plan).toBe(Plan.Pro);
      expect(updated?.trialEndsAt).toBeNull();
      expect(updated?.stripeSubscriptionId).toBe("sub_123");
    });
  });
});
