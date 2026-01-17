import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { ApiKeyRepository } from "./apiKeyRepository";

describe("ApiKeyRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: ApiKeyRepository;

  const testAccountId = new ObjectId();
  const testUserId = new ObjectId();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new ApiKeyRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("apiKeys").deleteMany({});
  });

  describe("create", () => {
    it("should create API key with all required fields", async () => {
      // Given: API key details
      const input = {
        accountId: testAccountId,
        createdByUserId: testUserId,
        name: "CI/CD Key",
        keyPrefix: "pk_myorg_abc",
        keyHash: "$2b$10$hashedvalue",
        scopes: ["builds:read", "builds:write"] as const,
      };

      // When: I create the API key
      const apiKey = await repo.create(input);

      // Then: I get back the key with all fields
      expect(apiKey._id).toBeDefined();
      expect(apiKey.accountId.toString()).toBe(testAccountId.toString());
      expect(apiKey.name).toBe("CI/CD Key");
      expect(apiKey.keyPrefix).toBe("pk_myorg_abc");
      expect(apiKey.keyHash).toBe("$2b$10$hashedvalue");
      expect(apiKey.scopes).toEqual(["builds:read", "builds:write"]);
      expect(apiKey.isRevoked).toBe(false);
      expect(apiKey.lastUsedAt).toBeNull();
      expect(apiKey.expiresAt).toBeNull();
    });
  });

  describe("findByPrefix", () => {
    it("should find API key by its prefix", async () => {
      // Given: an API key exists
      await repo.create({
        accountId: testAccountId,
        createdByUserId: testUserId,
        name: "Test Key",
        keyPrefix: "pk_test_xyz",
        keyHash: "$2b$10$hash",
        scopes: ["builds:read"],
      });

      // When: I find by prefix
      const found = await repo.findByPrefix("pk_test_xyz");

      // Then: I get the key
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Test Key");
    });

    it("should return null for unknown prefix", async () => {
      // When: I find by unknown prefix
      const found = await repo.findByPrefix("pk_unknown_123");

      // Then: I get null
      expect(found).toBeNull();
    });
  });

  describe("findByAccountId", () => {
    it("should return all keys for an account", async () => {
      // Given: multiple keys for an account
      await repo.create({
        accountId: testAccountId,
        createdByUserId: testUserId,
        name: "Key 1",
        keyPrefix: "pk_org_key1",
        keyHash: "$2b$10$hash1",
        scopes: ["builds:read"],
      });
      await repo.create({
        accountId: testAccountId,
        createdByUserId: testUserId,
        name: "Key 2",
        keyPrefix: "pk_org_key2",
        keyHash: "$2b$10$hash2",
        scopes: ["builds:write"],
      });

      // When: I find by account
      const keys = await repo.findByAccountId(testAccountId);

      // Then: I get both keys
      expect(keys).toHaveLength(2);
    });
  });

  describe("revoke", () => {
    it("should mark key as revoked", async () => {
      // Given: an API key exists
      const created = await repo.create({
        accountId: testAccountId,
        createdByUserId: testUserId,
        name: "Revokable Key",
        keyPrefix: "pk_rev_123",
        keyHash: "$2b$10$hash",
        scopes: ["builds:read"],
      });

      // When: I revoke it
      await repo.revoke(created._id);

      // Then: it's marked as revoked
      const found = await repo.findByPrefix("pk_rev_123");
      expect(found!.isRevoked).toBe(true);
    });
  });

  describe("updateLastUsed", () => {
    it("should update lastUsedAt timestamp", async () => {
      // Given: an API key exists
      const created = await repo.create({
        accountId: testAccountId,
        createdByUserId: testUserId,
        name: "Used Key",
        keyPrefix: "pk_used_123",
        keyHash: "$2b$10$hash",
        scopes: ["builds:read"],
      });
      expect(created.lastUsedAt).toBeNull();

      // When: I update last used
      await repo.updateLastUsed(created._id);

      // Then: lastUsedAt is set
      const found = await repo.findByPrefix("pk_used_123");
      expect(found!.lastUsedAt).not.toBeNull();
      expect(found!.lastUsedAt).toBeInstanceOf(Date);
    });
  });
});
