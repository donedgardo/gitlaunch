import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { AccountRepository } from "../../../repositories/accountRepository";
import { ApiKeyRepository } from "../../../repositories/apiKeyRepository";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerApiKeyRoutes } from "./apiKeys";
import { RecordingAnalytics } from "../../../services/analytics/fakes";

describe("API Key Routes", () => {
  let analytics: RecordingAnalytics;
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let apiKeyRepo: ApiKeyRepository;
  let apiKeyService: ApiKeyService;
  let sessionService: SessionService;

  const TEST_SECRET = "test-secret-for-sessions";
  const COOKIE_SECRET = "test-cookie-secret";

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("apiKeys").deleteMany({});

    accountRepo = new AccountRepository(db);
    apiKeyRepo = new ApiKeyRepository(db);
    apiKeyService = new ApiKeyService(apiKeyRepo, accountRepo);
    sessionService = new SessionService(TEST_SECRET);

    app = Fastify();
    await app.register(cookie, { secret: COOKIE_SECRET });
    await app.register(formbody);
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: {
        compileOptions: { preventIndent: true },
        partials: {
          navigation: "/partials/navigation.hbs",
        },
      },
    });
    sessionAuthMiddleware(app, sessionService);
    analytics = new RecordingAnalytics();
    registerApiKeyRoutes(app, { apiKeyService, analytics });
    await app.ready();
  });

  describe("GET /settings/api-keys", () => {
    it("should list existing API keys for the account", async () => {
      // Given: an account with an API key
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });
      const userId = new ObjectId();
      await apiKeyService.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "CI Key",
        scopes: ["builds:read", "builds:write"],
      });

      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: GET /settings/api-keys
      const response = await app.inject({
        method: "GET",
        url: "/settings/api-keys",
        cookies: { session: sessionToken },
      });

      // Then: response contains the key name and prefix
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("CI Key");
      expect(response.body).toContain("sk_test-org_");
    });

    it("should redirect unauthenticated users", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/settings/api-keys",
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/auth/github");
    });
  });

  describe("POST /settings/api-keys", () => {
    it("should generate a new API key and show it once", async () => {
      // Given: an authenticated account
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });
      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: POST to create a new key
      const response = await app.inject({
        method: "POST",
        url: "/settings/api-keys",
        cookies: { session: sessionToken },
        payload: { name: "Deploy Key" },
      });

      // Then: response contains the full key (shown once)
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("sk_test-org_");
      expect(response.body).toContain("Deploy Key");
    });

    it("should report the new key to analytics, attributed to the account", async () => {
      // Given: an authenticated account
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });
      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: POST to create a new key
      await app.inject({
        method: "POST",
        url: "/settings/api-keys",
        cookies: { session: sessionToken },
        payload: { name: "Deploy Key" },
      });

      // Then: the activation signal is emitted with tenant and actor, so it
      // can be counted in a funnel — and never the key itself.
      const event = analytics.tracked.find(
        (e) => e.event === "api_key_created",
      );
      expect(event).toBeDefined();
      expect(event?.context?.accountId).toBe(account._id.toString());
      expect(event?.context?.distinctId).toBe(userId.toString());
      expect(JSON.stringify(event?.properties)).not.toContain("sk_");
    });

    it("should redirect unauthenticated users", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/settings/api-keys",
        payload: { name: "Some Key" },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/auth/github");
    });
  });

  describe("POST /settings/api-keys/:id/revoke", () => {
    it("should revoke an API key", async () => {
      // Given: an account with an API key
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });
      const userId = new ObjectId();
      const { apiKey } = await apiKeyService.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "Old Key",
        scopes: ["builds:read", "builds:write"],
      });

      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: POST to revoke
      const response = await app.inject({
        method: "POST",
        url: `/settings/api-keys/${apiKey._id}/revoke`,
        cookies: { session: sessionToken },
      });

      // Then: key is revoked
      expect(response.statusCode).toBe(200);

      // And: key no longer validates
      const keys = await apiKeyService.listByAccount(account._id);
      expect(keys[0].isRevoked).toBe(true);
    });

    it("should return 404 when trying to revoke another account's key", async () => {
      // Given: two accounts, each with an API key
      const accountA = await accountRepo.create({
        name: "Org A",
        slug: "org-a",
      });
      const accountB = await accountRepo.create({
        name: "Org B",
        slug: "org-b",
      });
      const userA = new ObjectId();
      const userB = new ObjectId();

      const { apiKey: keyB } = await apiKeyService.generate({
        accountId: accountB._id,
        createdByUserId: userB,
        name: "B's Key",
        scopes: ["builds:read", "builds:write"],
      });

      // Given: user A is authenticated
      const sessionToken = sessionService.createSession({
        userId: userA,
        accountId: accountA._id,
      });

      // When: user A tries to revoke account B's key
      const response = await app.inject({
        method: "POST",
        url: `/settings/api-keys/${keyB._id}/revoke`,
        cookies: { session: sessionToken },
      });

      // Then: 404 (don't reveal the key exists)
      expect(response.statusCode).toBe(404);

      // And: key is NOT revoked
      const keys = await apiKeyService.listByAccount(accountB._id);
      expect(keys[0].isRevoked).toBe(false);
    });
  });
});
