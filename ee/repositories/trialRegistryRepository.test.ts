// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { TrialRegistryRepository } from "./trialRegistryRepository";

describe("TrialRegistryRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: TrialRegistryRepository;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new TrialRegistryRepository(db);
    await repo.ensureIndexes();
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clean up between tests
    await db.collection("trialRegistry").deleteMany({});
  });

  describe("claimTrial", () => {
    it("should claim trial for first-time user and return true", async () => {
      // Given: a user who has never claimed a trial
      const subject = "github:12345";
      const accountId = new ObjectId();

      // When: I claim the trial
      const result = await repo.claimTrial(subject, accountId);

      // Then: the trial is claimed successfully
      expect(result).toBe(true);
    });

    it("should persist the trial claim with timestamp", async () => {
      // Given: I claim a trial
      const subject = "github:67890";
      const accountId = new ObjectId();
      await repo.claimTrial(subject, accountId);

      // When: I check if the trial was used
      const hasUsed = await repo.hasUsedTrial(subject);

      // Then: the trial registry shows it was used
      expect(hasUsed).toBe(true);
    });

    it("should return false when user already claimed trial on same account", async () => {
      // Given: a user already claimed a trial
      const subject = "github:11111";
      const accountId = new ObjectId();
      await repo.claimTrial(subject, accountId);

      // When: the same user tries to claim again on the same account
      const result = await repo.claimTrial(subject, accountId);

      // Then: the claim is rejected (duplicate)
      expect(result).toBe(false);
    });

    it("should return false when user already claimed trial on different account", async () => {
      // Given: a user already claimed a trial on one account
      const subject = "github:22222";
      const accountId1 = new ObjectId();
      await repo.claimTrial(subject, accountId1);

      // When: the same user tries to claim on a different account
      const accountId2 = new ObjectId();
      const result = await repo.claimTrial(subject, accountId2);

      // Then: the claim is rejected (one trial per person)
      expect(result).toBe(false);
    });

    it("should allow different users to claim trials on the same account", async () => {
      // Given: one user claimed a trial on an account
      const accountId = new ObjectId();
      const subject1 = "github:33333";
      await repo.claimTrial(subject1, accountId);

      // When: a different user tries to claim on the same account
      const subject2 = "user:44444";
      const result = await repo.claimTrial(subject2, accountId);

      // Then: the claim succeeds (limit is per person, not account)
      expect(result).toBe(true);
    });
  });

  describe("hasUsedTrial", () => {
    it("should return true when user has claimed a trial", async () => {
      // Given: a user claimed a trial
      const subject = "github:55555";
      const accountId = new ObjectId();
      await repo.claimTrial(subject, accountId);

      // When: I check if they used their trial
      const result = await repo.hasUsedTrial(subject);

      // Then: it returns true
      expect(result).toBe(true);
    });

    it("should return false when user has not claimed a trial", async () => {
      // Given: a user who never claimed a trial
      const subject = "github:66666";

      // When: I check if they used their trial
      const result = await repo.hasUsedTrial(subject);

      // Then: it returns false
      expect(result).toBe(false);
    });
  });
});
