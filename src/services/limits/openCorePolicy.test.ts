import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository, Plan } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../repositories/membershipRepository";
import { NO_TRIALS, openCorePolicy } from "./openCorePolicy";
import { AccountPolicy } from "./accountPolicy";

// What the product does with the commercial code removed. These are the answers
// a build with no billing and no licensing gives, so they are also the contract
// the enterprise implementations have to stay compatible with.
describe("open core policy", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let membershipRepo: MembershipRepository;
  let policy: AccountPolicy;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    membershipRepo = new MembershipRepository(db);
    policy = openCorePolicy({
      accountRepository: accountRepo,
      repositoryRepository: new RepositoryRepository(db),
      serviceRepository: new ServiceRepository(db),
      membershipRepository: membershipRepo,
    });
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("memberships").deleteMany({});
  });

  async function anAccount() {
    return accountRepo.create({ name: "Solo", slug: `solo-${Date.now()}` });
  }

  describe("limits", () => {
    it("should report a single seat and no cap on anything else", async () => {
      // Given an open-core install
      const account = await anAccount();

      // When the dashboard asks what this account may use
      const usage = await policy.limits.getUsage(account._id);

      // Then seats are the one thing that is metered
      expect(usage.users.limit).toBe(1);
      expect(usage.services.limit).toBe(Number.MAX_SAFE_INTEGER);
      expect(usage.repositories.limit).toBe(Number.MAX_SAFE_INTEGER);
      expect(usage.privateReposAllowed).toBe(true);
    });

    it("should count the seat the owner is using", async () => {
      // Given an install whose one seat is taken
      const account = await anAccount();
      await membershipRepo.create({
        accountId: account._id,
        userId: new ObjectId(),
        role: MembershipRole.Owner,
      });

      // When usage is resolved
      const usage = await policy.limits.getUsage(account._id);

      // Then the seat shows as used, which is what a seat prompt reads
      expect(usage.users.current).toBe(1);
    });

    it("should never mark an open-core install read-only", async () => {
      // Given an open-core install
      const account = await anAccount();

      // When its state is resolved
      const state = await policy.limits.getAccountState(account._id);

      // Then nothing can take it read-only — there is no invoice to fail and no
      // trial to run out, so a licensing question cannot break a pipeline
      expect(state.isReadOnly).toBe(false);
      expect(state.paymentFailed).toBe(false);
      expect(state.trialDaysRemaining).toBe(0);
      expect(state.plan).toBe(Plan.Free);
    });

    it("should let the install grow its services, environments and repos", async () => {
      // Given an open-core install
      const account = await anAccount();

      // When it adds capacity of any kind
      // Then nothing stands in the way — capacity is not what we sell
      expect((await policy.limits.canAddService(account._id)).allowed).toBe(
        true,
      );
      expect(
        (await policy.limits.canAddEnvironment(account._id, new ObjectId()))
          .allowed,
      ).toBe(true);
      expect(
        (await policy.limits.canAddPrivateRepository(account._id)).allowed,
      ).toBe(true);
    });
  });

  describe("trials", () => {
    it("should refuse to start a trial", async () => {
      // Given open core, which has no plans to trial
      // When onboarding tries to start one
      const result = await NO_TRIALS.startTrial(
        new ObjectId(),
        "github:1",
        Plan.Pro,
      );

      // Then it declines with a reason rather than pretending to succeed
      expect(result.started).toBe(false);
    });

    it("should never report a trial as expired", async () => {
      // Given open core
      // When the dashboard checks for expiry on every page load
      const result = await NO_TRIALS.checkAndHandleTrialExpiry(new ObjectId());

      // Then there is nothing to expire, so no banner and no downgrade
      expect(result.expired).toBe(false);
    });
  });
});
