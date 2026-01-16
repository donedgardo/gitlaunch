import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import { AccountRepository } from "../../repositories/accountRepository";
import { ApiKeyRepository } from "../../repositories/apiKeyRepository";
import { ApiKeyService } from "../../services/apiKey/apiKeyService";
import { createApiKeyAuthMiddleware } from "./apiKeyAuth";

describe("API Key Auth Middleware", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let apiKeyRepo: ApiKeyRepository;
  let apiKeyService: ApiKeyService;
  let testApiKey: string;
  let testAccountId: ObjectId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    apiKeyRepo = new ApiKeyRepository(db);
    apiKeyService = new ApiKeyService(apiKeyRepo, accountRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("apiKeys").deleteMany({});

    // Create test account and API key
    const account = await accountRepo.create({
      name: "Test Org",
      slug: "test-org",
    });
    testAccountId = account._id;
    const result = await apiKeyService.generate({
      accountId: account._id,
      createdByUserId: new ObjectId(),
      name: "Test Key",
      scopes: ["builds:read", "builds:write"],
    });
    testApiKey = result.key;

    // Create fresh app for each test
    app = Fastify();

    // Add a test route that requires API key auth
    const apiKeyAuth = createApiKeyAuthMiddleware(apiKeyService);
    app.get("/api/test", { preHandler: apiKeyAuth }, async (request, reply) => {
      const apiKeyContext = (request as any).apiKey;
      return {
        authenticated: true,
        accountId: apiKeyContext.accountId.toString(),
        scopes: apiKeyContext.scopes,
      };
    });
  });

  describe("Authorization header", () => {
    it("should authenticate valid API key in Bearer token", async () => {
      // When: I make a request with valid API key
      const response = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      // Then: request succeeds with account context
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.authenticated).toBe(true);
      expect(body.accountId).toBe(testAccountId.toString());
      expect(body.scopes).toContain("builds:read");
    });

    it("should reject request without Authorization header", async () => {
      // When: I make a request without auth
      const response = await app.inject({
        method: "GET",
        url: "/api/test",
      });

      // Then: request is rejected with 401
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("API key required");
    });

    it("should reject request with invalid API key", async () => {
      // When: I make a request with invalid key
      const response = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: {
          Authorization: "Bearer lp_fake_invalidkey12345678901234",
        },
      });

      // Then: request is rejected with 401
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Invalid API key");
    });

    it("should reject request with revoked API key", async () => {
      // Given: the API key is revoked
      const found = await apiKeyRepo.findByPrefix(
        testApiKey.split("_").slice(0, 3).join("_").slice(0, -1) +
          testApiKey.split("_")[2].slice(0, 8),
      );
      // Actually let's get it properly
      const keys = await apiKeyRepo.findByAccountId(testAccountId);
      await apiKeyService.revoke(keys[0]._id);

      // When: I make a request with revoked key
      const response = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      // Then: request is rejected
      expect(response.statusCode).toBe(401);
    });
  });

  describe("X-API-Key header", () => {
    it("should authenticate valid API key in X-API-Key header", async () => {
      // When: I make a request with API key in X-API-Key header
      const response = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: {
          "X-API-Key": testApiKey,
        },
      });

      // Then: request succeeds
      expect(response.statusCode).toBe(200);
    });
  });
});
