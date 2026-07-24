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

      // Then: the key starts with sk_{slug}_ — "sk" for secret, so a full-power
      // key never reads as browser-safe the way a "pk_" (publishable) one does.
      expect(result.key).toMatch(new RegExp(`^sk_${slug}_[A-Za-z0-9_-]+$`));
      expect(result.apiKey.keyPrefix).toMatch(
        new RegExp(`^sk_${slug}_[A-Za-z0-9_-]{8}$`),
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

  // A publishable key is the one key we expect to ship inside a browser bundle,
  // so it is deliberately the weakest thing we can mint: one service, one
  // environment, evaluate-only, and usable only from origins you name.
  describe("generate (publishable)", () => {
    it("should mint a pk_ key bound to one service, environment and origin", async () => {
      // Given: an account and the service whose flags a web app will read
      const slug = uniqueSlug("web-org");
      const account = await accountRepo.create({ name: "Web Org", slug });
      const serviceId = new ObjectId();

      // When: I mint a publishable key for that service's prod flags
      const result = await service.generate({
        accountId: account._id,
        createdByUserId: new ObjectId(),
        name: "Web app",
        scopes: ["flags:evaluate"],
        kind: "publishable",
        serviceId,
        environment: "prod",
        allowedOrigins: ["https://example.com"],
      });

      // Then: it is publishable, and carries the binding that limits it
      expect(result.key).toMatch(new RegExp(`^pk_${slug}_[A-Za-z0-9_-]+$`));
      expect(result.apiKey.kind).toBe("publishable");
      expect(result.apiKey.serviceId?.toString()).toBe(serviceId.toString());
      expect(result.apiKey.environment).toBe("prod");
      expect(result.apiKey.allowedOrigins).toEqual(["https://example.com"]);
    });

    it("should refuse to mint a publishable key that is not bound to a service", async () => {
      // Given: an account
      const account = await accountRepo.create({
        name: "Web Org",
        slug: uniqueSlug("web-org"),
      });

      // When: I try to mint a publishable key with no service binding
      const attempt = service.generate({
        accountId: account._id,
        createdByUserId: new ObjectId(),
        name: "Unbound",
        scopes: ["flags:evaluate"],
        kind: "publishable",
        environment: "prod",
        allowedOrigins: ["https://example.com"],
      });

      // Then: it is rejected rather than minted account-wide
      await expect(attempt).rejects.toThrow(/service/i);
    });

    it("should refuse to mint a publishable key with powers beyond evaluating flags", async () => {
      // Given: an account
      const account = await accountRepo.create({
        name: "Web Org",
        slug: uniqueSlug("web-org"),
      });

      // When: I try to smuggle a write scope into a browser-visible key
      const attempt = service.generate({
        accountId: account._id,
        createdByUserId: new ObjectId(),
        name: "Too much",
        scopes: ["flags:evaluate", "flags:write"],
        kind: "publishable",
        serviceId: new ObjectId(),
        environment: "prod",
        allowedOrigins: ["https://example.com"],
      });

      // Then: it is rejected
      await expect(attempt).rejects.toThrow(/scope/i);
    });

    it("should validate a publishable key and report it as publishable", async () => {
      // Given: a minted publishable key
      const account = await accountRepo.create({
        name: "Web Org",
        slug: uniqueSlug("web-org"),
      });
      const minted = await service.generate({
        accountId: account._id,
        createdByUserId: new ObjectId(),
        name: "Web app",
        scopes: ["flags:evaluate"],
        kind: "publishable",
        serviceId: new ObjectId(),
        environment: "prod",
        allowedOrigins: ["https://example.com"],
      });

      // When: it is presented for validation
      const validated = await service.validate(minted.key);

      // Then: it resolves, still marked publishable
      expect(validated).not.toBeNull();
      expect(validated!.kind).toBe("publishable");
    });

    it("should still honour legacy pk_ keys as secret keys", async () => {
      // Given: a key minted before the sk_/pk_ split — pk_ prefix, no kind
      const slug = uniqueSlug("legacy-org");
      const account = await accountRepo.create({ name: "Legacy", slug });
      const fullKey = `pk_${slug}_legacyrandom123456`;
      await apiKeyRepo.create({
        accountId: account._id,
        createdByUserId: new ObjectId(),
        name: "legacy key",
        keyPrefix: `pk_${slug}_legacyra`,
        keyHash: await bcrypt.hash(fullKey, 10),
        scopes: ["flags:read"],
        expiresAt: null,
      });

      // When: the old key is presented
      const validated = await service.validate(fullKey);

      // Then: it still works, and is treated as a secret key (full privileges),
      // not silently downgraded or upgraded by its prefix alone
      expect(validated).not.toBeNull();
      expect(validated!.kind).not.toBe("publishable");
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
