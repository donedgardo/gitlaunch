import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../repositories/membershipRepository";
import {
  PlanEnforcementService,
  PlanLimitError,
} from "./planEnforcementService";

describe("PlanEnforcementService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let membershipRepo: MembershipRepository;
  let service: PlanEnforcementService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    repoRepo = new RepositoryRepository(db);
    membershipRepo = new MembershipRepository(db);
    service = new PlanEnforcementService(accountRepo, repoRepo, membershipRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});
    await db.collection("accountMemberships").deleteMany({});
  });

  describe("canAddRepository", () => {
    it("should allow free account to add first repository", async () => {
      // Given: a free account with no repositories
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org",
      });

      // When: checking if repo can be added
      const result = await service.canAddRepository(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });

    it("should reject free account adding second repository", async () => {
      // Given: a free account with one repository
      const account = await accountRepo.create({
        name: "Free Org 2",
        slug: "free-org-2",
      });
      await repoRepo.create({
        accountId: account._id,
        githubRepoId: 1234,
        githubFullName: "org/repo1",
        githubOwner: "org",
        githubRepoName: "repo1",
        isPrivate: false,
      });

      // When: checking if another repo can be added
      const result = await service.canAddRepository(account._id);

      // Then: it's rejected with upgrade message
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("limit");
      expect(result.upgradeRequired).toBe(true);
    });

    it("should allow paid account to add up to 5 repositories", async () => {
      // Given: a paid account with 4 repositories
      const account = await accountRepo.create({
        name: "Paid Org",
        slug: "paid-org",
      });
      await accountRepo.upgradeToPaid(account._id, "cus_test", "sub_test");

      for (let i = 0; i < 4; i++) {
        await repoRepo.create({
          accountId: account._id,
          githubRepoId: 1000 + i,
          githubFullName: `org/repo${i}`,
          githubOwner: "org",
          githubRepoName: `repo${i}`,
          isPrivate: false,
        });
      }

      // When: checking if 5th repo can be added
      const result = await service.canAddRepository(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });

    it("should reject paid account exceeding 5 repositories", async () => {
      // Given: a paid account with 5 repositories
      const account = await accountRepo.create({
        name: "Full Org",
        slug: "full-org",
      });
      await accountRepo.upgradeToPaid(account._id, "cus_full", "sub_full");

      for (let i = 0; i < 5; i++) {
        await repoRepo.create({
          accountId: account._id,
          githubRepoId: 2000 + i,
          githubFullName: `org/fullrepo${i}`,
          githubOwner: "org",
          githubRepoName: `fullrepo${i}`,
          isPrivate: false,
        });
      }

      // When: checking if 6th repo can be added
      const result = await service.canAddRepository(account._id);

      // Then: it's rejected
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("limit");
    });
  });

  describe("canAddPrivateRepository", () => {
    it("should reject free account adding private repository", async () => {
      // Given: a free account
      const account = await accountRepo.create({
        name: "Free Private",
        slug: "free-private",
      });

      // When: checking if private repo can be added
      const result = await service.canAddPrivateRepository(account._id);

      // Then: it's rejected
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("private");
      expect(result.upgradeRequired).toBe(true);
    });

    it("should allow paid account to add private repository", async () => {
      // Given: a paid account
      const account = await accountRepo.create({
        name: "Paid Private",
        slug: "paid-private",
      });
      await accountRepo.upgradeToPaid(account._id, "cus_priv", "sub_priv");

      // When: checking if private repo can be added
      const result = await service.canAddPrivateRepository(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });
  });

  describe("canAddUser", () => {
    it("should allow free account to have one user", async () => {
      // Given: a free account with no members
      const account = await accountRepo.create({
        name: "Solo Org",
        slug: "solo-org",
      });

      // When: checking if user can be added
      const result = await service.canAddUser(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });

    it("should reject free account adding second user", async () => {
      // Given: a free account with one member
      const account = await accountRepo.create({
        name: "Solo Org 2",
        slug: "solo-org-2",
      });
      await membershipRepo.create({
        userId: new ObjectId(),
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      // When: checking if another user can be added
      const result = await service.canAddUser(account._id);

      // Then: it's rejected
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("User");
      expect(result.upgradeRequired).toBe(true);
    });

    it("should allow paid account to add up to 5 users", async () => {
      // Given: a paid account with 4 members
      const account = await accountRepo.create({
        name: "Team Org",
        slug: "team-org",
      });
      await accountRepo.upgradeToPaid(account._id, "cus_team", "sub_team");

      for (let i = 0; i < 4; i++) {
        await membershipRepo.create({
          userId: new ObjectId(),
          accountId: account._id,
          role: i === 0 ? MembershipRole.Owner : MembershipRole.Member,
        });
      }

      // When: checking if 5th user can be added
      const result = await service.canAddUser(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });
  });

  describe("getUsage", () => {
    it("should return current usage and limits", async () => {
      // Given: a free account with some usage
      const account = await accountRepo.create({
        name: "Usage Org",
        slug: "usage-org",
      });
      await repoRepo.create({
        accountId: account._id,
        githubRepoId: 5000,
        githubFullName: "org/usage-repo",
        githubOwner: "org",
        githubRepoName: "usage-repo",
        isPrivate: false,
      });
      await membershipRepo.create({
        userId: new ObjectId(),
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      // When: I get usage
      const usage = await service.getUsage(account._id);

      // Then: I see current usage and limits
      expect(usage.repositories.current).toBe(1);
      expect(usage.repositories.limit).toBe(1);
      expect(usage.users.current).toBe(1);
      expect(usage.users.limit).toBe(1);
      expect(usage.privateReposAllowed).toBe(false);
    });

    it("should show paid limits for upgraded account", async () => {
      // Given: a paid account
      const account = await accountRepo.create({
        name: "Paid Usage",
        slug: "paid-usage",
      });
      await accountRepo.upgradeToPaid(account._id, "cus_usage", "sub_usage");

      // When: I get usage
      const usage = await service.getUsage(account._id);

      // Then: I see paid limits
      expect(usage.repositories.limit).toBe(5);
      expect(usage.users.limit).toBe(5);
      expect(usage.privateReposAllowed).toBe(true);
    });
  });

  describe("enforceRepositoryLimit", () => {
    it("should throw PlanLimitError when limit exceeded", async () => {
      // Given: a free account at repository limit
      const account = await accountRepo.create({
        name: "Enforce Org",
        slug: "enforce-org",
      });
      await repoRepo.create({
        accountId: account._id,
        githubRepoId: 6000,
        githubFullName: "org/enforce-repo",
        githubOwner: "org",
        githubRepoName: "enforce-repo",
        isPrivate: false,
      });

      // When/Then: enforcing throws error
      await expect(service.enforceRepositoryLimit(account._id)).rejects.toThrow(
        PlanLimitError,
      );
    });

    it("should not throw when under limit", async () => {
      // Given: a free account under limit
      const account = await accountRepo.create({
        name: "Under Org",
        slug: "under-org",
      });

      // When/Then: enforcing doesn't throw
      await expect(
        service.enforceRepositoryLimit(account._id),
      ).resolves.not.toThrow();
    });
  });
});
