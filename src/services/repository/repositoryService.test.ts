import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
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
      // Given: a free account (max 1 repo) already at limit
      const account = await accountRepo.create({
        name: "Full Org",
        slug: "full-org",
      });
      await service.addRepository({
        accountId: account._id,
        githubRepoId: 1,
        githubFullName: "org/first-repo",
        githubOwner: "org",
        githubRepoName: "first-repo",
        isPrivate: false,
      });

      // When: I try to add another repository
      // Then: it should reject with clear error
      await expect(
        service.addRepository({
          accountId: account._id,
          githubRepoId: 2,
          githubFullName: "org/second-repo",
          githubOwner: "org",
          githubRepoName: "second-repo",
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
  });
});
