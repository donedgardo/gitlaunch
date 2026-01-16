import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { RepositoryRepository } from "./repositoryRepository";

describe("RepositoryRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: RepositoryRepository;

  const testAccountId = new ObjectId();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new RepositoryRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("repositories").deleteMany({});
  });

  describe("create", () => {
    it("should create repository with generated ID and default environments", async () => {
      // Given: repository details for an account
      const input = {
        accountId: testAccountId,
        githubRepoId: 123456,
        githubFullName: "my-org/my-repo",
        githubOwner: "my-org",
        githubRepoName: "my-repo",
        isPrivate: false,
      };

      // When: I create the repository
      const repository = await repo.create(input);

      // Then: I get back a repository with ID and default environments
      expect(repository._id).toBeDefined();
      expect(repository.accountId.toString()).toBe(testAccountId.toString());
      expect(repository.githubFullName).toBe("my-org/my-repo");
      expect(repository.githubRepoId).toBe(123456);
      expect(repository.isActive).toBe(true);
      expect(repository.workflowFile).toBe("deploy.yml");
      expect(repository.eventType).toBe("deployment");

      // Default environments
      expect(repository.environments).toHaveLength(2);
      expect(repository.environments[0]).toEqual({
        name: "staging",
        displayName: "Staging",
        order: 0,
      });
      expect(repository.environments[1]).toEqual({
        name: "prod",
        displayName: "Production",
        order: 1,
      });
    });

    it("should persist the repository so it can be retrieved later", async () => {
      // Given: I create a repository
      const input = {
        accountId: testAccountId,
        githubRepoId: 789,
        githubFullName: "org/persisted-repo",
        githubOwner: "org",
        githubRepoName: "persisted-repo",
        isPrivate: false,
      };
      const created = await repo.create(input);

      // When: I find repositories for the account
      const found = await repo.findByAccountId(testAccountId);

      // Then: I find the same repository
      expect(found).toHaveLength(1);
      expect(found[0]._id.toString()).toBe(created._id.toString());
    });
  });

  describe("findByAccountId", () => {
    it("should return only repositories belonging to that account", async () => {
      // Given: two accounts with repos
      const accountA = new ObjectId();
      const accountB = new ObjectId();

      await repo.create({
        accountId: accountA,
        githubRepoId: 1,
        githubFullName: "org-a/repo-a",
        githubOwner: "org-a",
        githubRepoName: "repo-a",
        isPrivate: false,
      });
      await repo.create({
        accountId: accountB,
        githubRepoId: 2,
        githubFullName: "org-b/repo-b",
        githubOwner: "org-b",
        githubRepoName: "repo-b",
        isPrivate: false,
      });

      // When: I query for account A's repos
      const reposA = await repo.findByAccountId(accountA);

      // Then: I only get account A's repos
      expect(reposA).toHaveLength(1);
      expect(reposA[0].githubFullName).toBe("org-a/repo-a");
    });

    it("should return empty array when account has no repositories", async () => {
      // Given: an account with no repos
      const emptyAccountId = new ObjectId();

      // When: I query for that account's repos
      const repos = await repo.findByAccountId(emptyAccountId);

      // Then: I get an empty array
      expect(repos).toEqual([]);
    });
  });
});
