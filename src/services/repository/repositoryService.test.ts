import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { AccountRepository, Plan } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { RepositoryService } from "./repositoryService";

describe("RepositoryService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let service: RepositoryService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    repoRepo = new RepositoryRepository(db);
    service = new RepositoryService(accountRepo, repoRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});
  });

  describe("addRepository", () => {
    it("should add repository when under plan limit", async () => {
      // Given: a free account (max 1 repo) with no repos
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org",
      });

      // When: I add a repository
      const result = await service.addRepository({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });

      // Then: the repository is created
      expect(result._id).toBeDefined();
      expect(result.githubFullName).toBe("org/repo");
    });

    it("should reject when account would exceed plan limit", async () => {
      // Given: a free account (max 3 repos) already at limit
      const account = await accountRepo.create({
        name: "Full Org",
        slug: "full-org",
      });
      // Add 3 repos to reach the limit
      for (let i = 1; i <= 3; i++) {
        await service.addRepository({
          accountId: account._id,
          githubRepoId: i,
          githubFullName: `org/repo-${i}`,
          githubOwner: "org",
          githubRepoName: `repo-${i}`,
          isPrivate: false,
        });
      }

      // When: I try to add a 4th repository
      // Then: it should reject with clear error
      await expect(
        service.addRepository({
          accountId: account._id,
          githubRepoId: 4,
          githubFullName: "org/fourth-repo",
          githubOwner: "org",
          githubRepoName: "fourth-repo",
          isPrivate: false,
        }),
      ).rejects.toThrow(
        "Repository limit reached. Upgrade your plan to add more repositories.",
      );
    });

    it("should reject private repo on free plan", async () => {
      // Given: a free account (public repos only)
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org-2",
      });

      // When: I try to add a private repository
      // Then: it should reject with clear error
      await expect(
        service.addRepository({
          accountId: account._id,
          githubRepoId: 123,
          githubFullName: "org/private-repo",
          githubOwner: "org",
          githubRepoName: "private-repo",
          isPrivate: true,
        }),
      ).rejects.toThrow("Private repositories require a paid plan.");
    });

    it("should reject duplicate repo on free plan", async () => {
      // Given: a free account with a repo already added
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org-dup",
      });
      await service.addRepository({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/monorepo",
        githubOwner: "org",
        githubRepoName: "monorepo",
        isPrivate: false,
      });

      // When: I try to add the same repo again
      // Then: it should reject (monorepo support requires paid plan)
      await expect(
        service.addRepository({
          accountId: account._id,
          githubRepoId: 123,
          githubFullName: "org/monorepo",
          githubOwner: "org",
          githubRepoName: "monorepo",
          isPrivate: false,
        }),
      ).rejects.toThrow(
        "Monorepo support requires a paid plan. Upgrade to add the same repository multiple times.",
      );
    });

    it("should allow duplicate repo on paid plan for monorepo support", async () => {
      // Given: a paid account with a repo already added
      const account = await accountRepo.create({
        name: "Paid Org",
        slug: "paid-org-mono",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_test",
        "sub_test",
        Plan.Pro,
      );

      await service.addRepository({
        accountId: account._id,
        githubRepoId: 456,
        githubFullName: "org/monorepo",
        githubOwner: "org",
        githubRepoName: "monorepo",
        isPrivate: false,
      });

      // When: I add the same repo again (different service in monorepo)
      const result = await service.addRepository({
        accountId: account._id,
        githubRepoId: 456,
        githubFullName: "org/monorepo",
        githubOwner: "org",
        githubRepoName: "monorepo",
        isPrivate: false,
      });

      // Then: it should succeed (paid plan allows monorepo)
      expect(result._id).toBeDefined();
      expect(result.githubRepoId).toBe(456);
    });
  });
});
