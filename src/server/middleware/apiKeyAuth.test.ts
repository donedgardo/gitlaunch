import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import { AccountRepository } from "../../repositories/accountRepository";
import { ApiKeyRepository } from "../../repositories/apiKeyRepository";
import { ApiKeyService } from "../../services/apiKey/apiKeyService";
import {
  createApiKeyAuthMiddleware,
  requireScope,
  requireFlagRuntimeAccess,
  requireEnvironmentAccess,
  requireAllEnvironments,
} from "./apiKeyAuth";

describe("API Key Auth Middleware", { sequential: true, retry: 2 }, () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let apiKeyRepo: ApiKeyRepository;
  let apiKeyService: ApiKeyService;
  let testApiKey: string;
  let testAccountId: ObjectId;

  const uniqueSlug = (base: string) =>
    `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
      slug: uniqueSlug("test-org"),
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

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
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
          Authorization: "Bearer pk_fake_invalidkey12345678901234",
        },
      });

      // Then: request is rejected with 401
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Invalid API key");
    });

    it("should reject request with revoked API key", async () => {
      // Given: the API key is revoked
      await apiKeyRepo.findByPrefix(
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

  // A publishable key lives in a browser bundle, so anyone who wants it has it.
  // Its value is not secrecy but confinement: one service, one environment,
  // evaluate-only, from origins you named.
  describe("publishable keys", () => {
    const BOUND_SERVICE = new ObjectId();
    const ORIGIN = "https://app.example.com";

    // A route pair mirroring the real API: the evaluate endpoint a browser may
    // reach, and a flags:read endpoint it must never reach.
    async function appWithFlagRoutes(): Promise<FastifyInstance> {
      const local = Fastify();
      const auth = createApiKeyAuthMiddleware(apiKeyService);
      local.get(
        "/api/v1/services/:serviceId/environments/:env/flags/evaluate",
        { preHandler: [auth, requireFlagRuntimeAccess()] },
        async () => ({ ok: true }),
      );
      local.get(
        "/api/v1/services/:serviceId/flags",
        { preHandler: [auth, requireScope("flags:read")] },
        async () => ({ ok: true }),
      );
      await local.ready();
      return local;
    }

    async function publishableKey(): Promise<string> {
      const minted = await apiKeyService.generate({
        accountId: testAccountId,
        createdByUserId: new ObjectId(),
        name: "Web app",
        scopes: ["flags:evaluate"],
        kind: "publishable",
        serviceId: BOUND_SERVICE,
        environment: "prod",
        allowedOrigins: [ORIGIN],
      });
      return minted.key;
    }

    let flagApp: FastifyInstance;

    beforeEach(async () => {
      flagApp = await appWithFlagRoutes();
    });

    afterEach(async () => {
      await flagApp.close();
    });

    it("should evaluate flags for the service and environment it is bound to", async () => {
      // Given: a publishable key for one service's prod flags
      const key = await publishableKey();

      // When: a browser on the allow-listed origin evaluates that exact scope
      const response = await flagApp.inject({
        method: "GET",
        url: `/api/v1/services/${BOUND_SERVICE}/environments/prod/flags/evaluate?entity=u1`,
        headers: { Authorization: `Bearer ${key}`, Origin: ORIGIN },
      });

      // Then: it is allowed
      expect(response.statusCode).toBe(200);
    });

    it("should refuse to evaluate a service it is not bound to", async () => {
      // Given: a publishable key bound to one service
      const key = await publishableKey();

      // When: it is pointed at a different service in the same account
      const response = await flagApp.inject({
        method: "GET",
        url: `/api/v1/services/${new ObjectId()}/environments/prod/flags/evaluate?entity=u1`,
        headers: { Authorization: `Bearer ${key}`, Origin: ORIGIN },
      });

      // Then: it is refused — this is the account-wide leak we are closing
      expect(response.statusCode).toBe(403);
    });

    it("should refuse to evaluate an environment it is not bound to", async () => {
      // Given: a prod-bound publishable key
      const key = await publishableKey();

      // When: it is pointed at staging
      const response = await flagApp.inject({
        method: "GET",
        url: `/api/v1/services/${BOUND_SERVICE}/environments/staging/flags/evaluate?entity=u1`,
        headers: { Authorization: `Bearer ${key}`, Origin: ORIGIN },
      });

      // Then: it is refused
      expect(response.statusCode).toBe(403);
    });

    it("should refuse a request from an origin that was not allow-listed", async () => {
      // Given: a publishable key allowed only from app.example.com
      const key = await publishableKey();

      // When: someone uses it from their own site
      const response = await flagApp.inject({
        method: "GET",
        url: `/api/v1/services/${BOUND_SERVICE}/environments/prod/flags/evaluate?entity=u1`,
        headers: {
          Authorization: `Bearer ${key}`,
          Origin: "https://attacker.example",
        },
      });

      // Then: it is refused
      expect(response.statusCode).toBe(403);
    });

    it("should refuse to read flag configuration, only evaluate", async () => {
      // Given: a publishable key
      const key = await publishableKey();

      // When: it is used against the flags:read endpoint, which would expose
      // rule config and targeting rules
      const response = await flagApp.inject({
        method: "GET",
        url: `/api/v1/services/${BOUND_SERVICE}/flags`,
        headers: { Authorization: `Bearer ${key}`, Origin: ORIGIN },
      });

      // Then: it is refused regardless of scope arithmetic
      expect(response.statusCode).toBe(403);
    });

    it("should let the browser read the response by echoing its origin", async () => {
      // Given: a publishable key allow-listing one origin
      const key = await publishableKey();

      // When: the browser on that origin evaluates flags
      const response = await flagApp.inject({
        method: "GET",
        url: `/api/v1/services/${BOUND_SERVICE}/environments/prod/flags/evaluate?entity=u1`,
        headers: { Authorization: `Bearer ${key}`, Origin: ORIGIN },
      });

      // Then: CORS lets the page actually read the result, and the response is
      // marked as varying by origin so a shared cache cannot cross-serve it
      expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(String(response.headers["vary"])).toContain("Origin");
    });

    it("should let the browser read the refusal when the origin is not allowed", async () => {
      // Given: a publishable key used from somewhere it shouldn't be
      const key = await publishableKey();

      // When: the request is refused
      const response = await flagApp.inject({
        method: "GET",
        url: `/api/v1/services/${BOUND_SERVICE}/environments/prod/flags/evaluate?entity=u1`,
        headers: {
          Authorization: `Bearer ${key}`,
          Origin: "https://attacker.example",
        },
      });

      // Then: the developer sees our 403 rather than an opaque CORS error.
      // Echoing the origin on an error body leaks nothing.
      expect(response.statusCode).toBe(403);
      expect(response.headers["access-control-allow-origin"]).toBe(
        "https://attacker.example",
      );
    });

    it("should still let an existing secret flags:read key evaluate flags", async () => {
      // Given: a server-side key of the kind customers already hold
      const secret = await apiKeyService.generate({
        accountId: testAccountId,
        createdByUserId: new ObjectId(),
        name: "Server key",
        scopes: ["flags:read"],
      });

      // When: it evaluates flags, with no Origin (it is not a browser)
      const response = await flagApp.inject({
        method: "GET",
        url: `/api/v1/services/${new ObjectId()}/environments/prod/flags/evaluate?entity=u1`,
        headers: { Authorization: `Bearer ${secret.key}` },
      });

      // Then: nothing changes for it
      expect(response.statusCode).toBe(200);
    });
  });

  describe("keys limited to certain environments", () => {
    let envApp: FastifyInstance;

    // Mirrors the real API: one write addressed to an environment, and one
    // write that touches every environment at once.
    beforeEach(async () => {
      envApp = Fastify();
      const auth = createApiKeyAuthMiddleware(apiKeyService);
      envApp.post(
        "/api/v1/services/:serviceId/builds/:buildId/deploy/:env",
        {
          preHandler: [
            auth,
            requireScope("deployments:write"),
            requireEnvironmentAccess(),
          ],
        },
        async () => ({ ok: true }),
      );
      envApp.delete(
        "/api/v1/services/:serviceId/flags/:key",
        {
          preHandler: [
            auth,
            requireScope("flags:write"),
            requireAllEnvironments(),
          ],
        },
        async () => ({ ok: true }),
      );
      await envApp.ready();
    });

    afterEach(async () => {
      await envApp.close();
    });

    async function mint(allowedEnvironments?: string[]): Promise<string> {
      const minted = await apiKeyService.generate({
        accountId: testAccountId,
        createdByUserId: new ObjectId(),
        name: "Staging agent",
        scopes: ["deployments:write", "flags:write"],
        allowedEnvironments,
      });
      return minted.key;
    }

    const deploy = (key: string, env: string) =>
      envApp.inject({
        method: "POST",
        url: `/api/v1/services/${new ObjectId()}/builds/abc/deploy/${env}`,
        headers: { authorization: `Bearer ${key}` },
      });

    it("should let a limited key act on an environment in its list", async () => {
      const key = await mint(["staging"]);

      const response = await deploy(key, "staging");

      expect(response.statusCode).toBe(200);
    });

    it("should refuse a limited key acting on an environment outside its list", async () => {
      const key = await mint(["staging"]);

      const response = await deploy(key, "prod");

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error).toBe(
        'This key is not allowed to act on environment "prod".',
      );
    });

    it("should let a key with no limit act on any environment", async () => {
      const key = await mint();

      const response = await deploy(key, "prod");

      expect(response.statusCode).toBe(200);
    });

    it("should refuse a limited key a change that reaches every environment", async () => {
      const key = await mint(["staging"]);

      const response = await envApp.inject({
        method: "DELETE",
        url: `/api/v1/services/${new ObjectId()}/flags/beta`,
        headers: { authorization: `Bearer ${key}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should let a key with no limit make a change that reaches every environment", async () => {
      const key = await mint();

      const response = await envApp.inject({
        method: "DELETE",
        url: `/api/v1/services/${new ObjectId()}/flags/beta`,
        headers: { authorization: `Bearer ${key}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should refuse to limit a publishable key, which is already bound to one environment", async () => {
      await expect(
        apiKeyService.generate({
          accountId: testAccountId,
          createdByUserId: new ObjectId(),
          name: "Web app",
          scopes: ["flags:evaluate"],
          kind: "publishable",
          serviceId: new ObjectId(),
          environment: "prod",
          allowedOrigins: ["https://app.example.com"],
          allowedEnvironments: ["staging"],
        }),
      ).rejects.toThrow(/publishable/i);
    });
  });

  describe("who the key is", () => {
    it("should expose the key's name and who created it, for attribution", async () => {
      // Given: a named key created by a particular person
      const createdByUserId = new ObjectId();
      const minted = await apiKeyService.generate({
        accountId: testAccountId,
        createdByUserId,
        name: "staging-agent",
        scopes: ["builds:read"],
      });
      const local = Fastify();
      local.get(
        "/whoami",
        { preHandler: createApiKeyAuthMiddleware(apiKeyService) },
        async (request) => ({
          name: request.apiKey!.name,
          createdByUserId: request.apiKey!.createdByUserId?.toString(),
        }),
      );
      await local.ready();

      // When: it authenticates
      const response = await local.inject({
        method: "GET",
        url: "/whoami",
        headers: { authorization: `Bearer ${minted.key}` },
      });
      await local.close();

      // Then: the request knows which key it is and whose
      expect(JSON.parse(response.body)).toEqual({
        name: "staging-agent",
        createdByUserId: createdByUserId.toString(),
      });
    });
  });
});
