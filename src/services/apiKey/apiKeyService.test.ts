import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import * as bcrypt from "bcrypt";
import { AccountRepository } from "../../repositories/accountRepository";
import { ApiKeyRepository } from "../../repositories/apiKeyRepository";
import { ApiKeyService } from "./apiKeyService";

describe("ApiKeyService", { sequential: true }, () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let apiKeyRepo: ApiKeyRepository;
  let service: ApiKeyService;

  // Helper to generate unique slugs
  const uniqueSlug = (base: string) =>
    `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    apiKeyRepo = new ApiKeyRepository(db);
    service = new ApiKeyService(apiKeyRepo, accountRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("apiKeys").deleteMany({});
  });

  describe("generate", () => {
    it("should generate API key with correct prefix format", async () => {
      // Given: an account exists
      const slug = uniqueSlug("my-org");
      const account = await accountRepo.create({ name: "My Org", slug });
      const userId = new ObjectId();

      // When: I generate an API key
      const result = await service.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "CI/CD Key",
        scopes: ["builds:read", "builds:write"],
      });

      // Then: the key starts with pk_{slug}_
      expect(result.key).toMatch(new RegExp(`^pk_${slug}_[A-Za-z0-9_-]+$`));
      expect(result.apiKey.keyPrefix).toMatch(
        new RegExp(`^pk_${slug}_[A-Za-z0-9_-]{8}$`),
      );
    });

    it("should return the full key only once (not stored)", async () => {
      // Given: an account exists
      const account = await accountRepo.create({
        name: "My Org",
        slug: uniqueSlug("my-org"),
      });
      const userId = new ObjectId();

      // When: I generate an API key
      const result = await service.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "Secret Key",
        scopes: ["builds:read"],
      });

      // Then: I get the full key
      expect(result.key.length).toBeGreaterThan(30);

      // And: the stored record only has the prefix, not the full key
      const stored = await apiKeyRepo.findByPrefix(result.apiKey.keyPrefix);
      expect(stored).not.toBeNull();
      expect(stored!.keyHash).not.toBe(result.key);
      expect(stored!.keyHash).toMatch(/^\$2[aby]\$/); // bcrypt hash format
    });

    it("should store key hash that can validate the original key", async () => {
      // Given: an account and a generated key
      const account = await accountRepo.create({
        name: "My Org",
        slug: uniqueSlug("my-org"),
      });
      const userId = new ObjectId();
      const result = await service.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "Validate Key",
        scopes: ["builds:read"],
      });

      // When: I validate with the correct key
      const isValid = await service.validate(result.key);

      // Then: validation passes
      expect(isValid).not.toBeNull();
      expect(isValid!.name).toBe("Validate Key");
    });
  });

  describe("validate", () => {
    it("should return null for invalid key format", async () => {
      // When: I validate a malformed key
      const result = await service.validate("not-a-valid-key");

      // Then: validation fails
      expect(result).toBeNull();
    });

    it("should return null for unknown key prefix", async () => {
      // When: I validate a key with unknown prefix
      const result = await service.validate(
        "pk_unknown_abcdefgh1234567890123456789012",
      );

      // Then: validation fails
      expect(result).toBeNull();
    });

    it("should validate a key whose random segment contains an underscore", async () => {
      // base64url random parts can contain "_"; the stored prefix is the first
      // 8 chars of that random segment, so validation must not break on the "_".
      const slug = uniqueSlug("underscore-org");
      const account = await accountRepo.create({ name: "Underscore", slug });
      const random = "a_b1c2d3e4f5";
      const fullKey = `pk_${slug}_${random}`;
      const keyPrefix = `pk_${slug}_${random.slice(0, 8)}`;
      const keyHash = await bcrypt.hash(fullKey, 10);
      await apiKeyRepo.create({
        accountId: account._id,
        createdByUserId: new ObjectId(),
        name: "underscore key",
        keyPrefix,
        keyHash,
        scopes: ["builds:write"],
        expiresAt: null,
      });

      // When: I validate the full key
      const result = await service.validate(fullKey);

      // Then: it resolves to the stored key
      expect(result).not.toBeNull();
      expect(result?.keyPrefix).toBe(keyPrefix);
    });

    it("should return null for revoked key", async () => {
      // Given: a revoked API key
      const account = await accountRepo.create({
        name: "My Org",
        slug: uniqueSlug("my-org"),
      });
      const userId = new ObjectId();
      const result = await service.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "Revoked Key",
        scopes: ["builds:read"],
      });
      await service.revoke(result.apiKey._id);

      // When: I validate the revoked key
      const validated = await service.validate(result.key);

      // Then: validation fails
      expect(validated).toBeNull();
    });

    it("should return null for expired key", async () => {
      // Given: an expired API key
      const account = await accountRepo.create({
        name: "My Org",
        slug: uniqueSlug("my-org"),
      });
      const userId = new ObjectId();
      const result = await service.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "Expired Key",
        scopes: ["builds:read"],
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      });

      // When: I validate the expired key
      const validated = await service.validate(result.key);

      // Then: validation fails
      expect(validated).toBeNull();
    });

    it("should update lastUsedAt on successful validation", async () => {
      // Given: an API key
      const account = await accountRepo.create({
        name: "My Org",
        slug: uniqueSlug("my-org"),
      });
      const userId = new ObjectId();
      const result = await service.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "Track Usage",
        scopes: ["builds:read"],
      });
      const initialKey = await apiKeyRepo.findByPrefix(result.apiKey.keyPrefix);
      expect(initialKey!.lastUsedAt).toBeNull();

      // When: I validate the key
      await service.validate(result.key);

      // Then: lastUsedAt is updated
      const afterValidation = await apiKeyRepo.findByPrefix(
        result.apiKey.keyPrefix,
      );
      expect(afterValidation!.lastUsedAt).not.toBeNull();
    });
  });

  describe("revoke", () => {
    it("should mark key as revoked", async () => {
      // Given: an API key
      const account = await accountRepo.create({
        name: "My Org",
        slug: uniqueSlug("my-org"),
      });
      const userId = new ObjectId();
      const result = await service.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "To Revoke",
        scopes: ["builds:read"],
      });

      // When: I revoke it
      await service.revoke(result.apiKey._id);

      // Then: it's revoked
      const found = await apiKeyRepo.findByPrefix(result.apiKey.keyPrefix);
      expect(found!.isRevoked).toBe(true);
    });
  });

  describe("listByAccount", () => {
    it("should return all keys for an account (without hashes)", async () => {
      // Given: multiple keys for an account
      const account = await accountRepo.create({
        name: "My Org",
        slug: uniqueSlug("my-org"),
      });
      const userId = new ObjectId();
      await service.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "Key 1",
        scopes: ["builds:read"],
      });
      await service.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "Key 2",
        scopes: ["builds:write"],
      });

      // When: I list keys for the account
      const keys = await service.listByAccount(account._id);

      // Then: I get both keys
      expect(keys).toHaveLength(2);
      expect(keys.map((k) => k.name).sort()).toEqual(["Key 1", "Key 2"]);
    });
  });
});
