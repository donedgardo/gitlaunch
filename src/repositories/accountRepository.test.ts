import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { AccountRepository } from "./accountRepository";

describe("AccountRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: AccountRepository;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new AccountRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clean up between tests
    await db.collection("accounts").deleteMany({});
  });

  describe("create", () => {
    it("should create account and return it with generated ID and default free plan", async () => {
      // Given: account details
      const input = { name: "My Organization", slug: "my-org" };

      // When: I create the account
      const account = await repo.create(input);

      // Then: I get back an account with the details and a generated ID
      expect(account.name).toBe("My Organization");
      expect(account.slug).toBe("my-org");
      expect(account._id).toBeDefined();
      expect(account.plan).toBe("free");
      expect(account.planLimits.maxRepositories).toBe(1);
      expect(account.planLimits.maxUsers).toBe(1);
      expect(account.planLimits.publicReposOnly).toBe(true);
    });

    it("should persist the account so it can be retrieved later", async () => {
      // Given: I create an account
      const input = { name: "Persisted Org", slug: "persisted-org" };
      const created = await repo.create(input);

      // When: I look it up by slug
      const found = await repo.findBySlug("persisted-org");

      // Then: I find the same account
      expect(found).not.toBeNull();
      expect(found!._id.toString()).toBe(created._id.toString());
      expect(found!.name).toBe("Persisted Org");
    });
  });

  describe("create with duplicate slug", () => {
    it("should reject duplicate slug with clear error", async () => {
      // Given: an account with slug "taken" exists
      await repo.create({ name: "First Org", slug: "taken" });

      // When: I try to create another account with the same slug
      // Then: it should throw a clear error
      await expect(
        repo.create({ name: "Second Org", slug: "taken" }),
      ).rejects.toThrow("Account with slug 'taken' already exists");
    });
  });

  describe("findBySlug", () => {
    it("should return the account when found by slug", async () => {
      // Given: an account exists
      await repo.create({ name: "Find Me", slug: "find-me" });

      // When: I look it up by slug
      const result = await repo.findBySlug("find-me");

      // Then: I get the account back
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Find Me");
      expect(result!.slug).toBe("find-me");
    });

    it("should return null when account not found", async () => {
      // When: I look up a slug that doesn't exist
      const result = await repo.findBySlug("non-existent");

      // Then: I get null
      expect(result).toBeNull();
    });
  });

  describe("findById", () => {
    it("should return the account when found by ID", async () => {
      // Given: an account exists
      const created = await repo.create({
        name: "Find By ID",
        slug: "find-by-id",
      });

      // When: I look it up by ID
      const result = await repo.findById(created._id);

      // Then: I get the account back
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Find By ID");
      expect(result!._id.toString()).toBe(created._id.toString());
    });
  });

  describe("updateInstallation", () => {
    it("should update account with installation ID", async () => {
      // Given: an account exists
      const created = await repo.create({
        name: "Install Me",
        slug: "install-me",
      });
      expect(created.githubInstallationId).toBeNull();

      // When: I update the installation
      await repo.updateInstallation(created._id, 12345);

      // Then: the account has the installation ID
      const updated = await repo.findById(created._id);
      expect(updated?.githubInstallationId).toBe(12345);
    });
  });
});
