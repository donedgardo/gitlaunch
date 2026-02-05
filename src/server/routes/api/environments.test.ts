import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { EnvironmentService } from "../../../services/environment/environmentService";
import { registerEnvironmentsRoutes } from "./environments";
import { ApiKeyScope } from "../../../repositories/apiKeyRepository";

// Simple mock auth middleware for testing
function createMockApiKeyAuth(
  getContext: () => { accountId: ObjectId; scopes: ApiKeyScope[] } | null,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const xApiKey = request.headers["x-api-key"] as string | undefined;

    const hasAuth = authHeader?.startsWith("Bearer ") || xApiKey;

    if (!hasAuth) {
      return reply.status(401).send({ error: "API key required" });
    }

    const context = getContext();
    if (!context) {
      return reply.status(401).send({ error: "Invalid API key" });
    }

    request.apiKey = {
      accountId: context.accountId,
      apiKeyId: new ObjectId(),
      scopes: context.scopes,
    };
  };
}

describe("Environments API Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let serviceRepo: ServiceRepository;
  let environmentService: EnvironmentService;

  let testAccountId: ObjectId;
  let testServiceId: ObjectId;
  let currentAuthContext: { accountId: ObjectId; scopes: ApiKeyScope[] } | null;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");

    accountRepo = new AccountRepository(db);
    repoRepo = new RepositoryRepository(db);
    serviceRepo = new ServiceRepository(db);
    environmentService = new EnvironmentService(serviceRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});
    await db.collection("services").deleteMany({});

    // Create fresh app for each test
    app = Fastify();
    app.addHook(
      "preHandler",
      createMockApiKeyAuth(() => currentAuthContext),
    );
    registerEnvironmentsRoutes(app, { environmentService });
    await app.ready();

    // Create test account and service
    const account = await accountRepo.create({
      name: "Test Org",
      slug: "test-org",
    });
    testAccountId = account._id;

    const repo = await repoRepo.create({
      accountId: testAccountId,
      githubRepoId: 123,
      githubFullName: "org/repo",
      githubOwner: "org",
      githubRepoName: "repo",
      isPrivate: false,
    });

    const service = await serviceRepo.create({
      accountId: testAccountId,
      repositoryId: repo._id,
      name: "backend",
    });
    testServiceId = service._id;

    // Default auth context
    currentAuthContext = {
      accountId: testAccountId,
      scopes: ["services:read", "services:write"],
    };
  });

  describe("GET /api/v1/services/:serviceId/environments", () => {
    it("should list environments for a service", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/environments`,
        headers: { authorization: "Bearer test-key" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.environments).toHaveLength(2);
      expect(body.environments[0].name).toBe("staging");
      expect(body.environments[1].name).toBe("prod");
    });

    it("should return 401 without API key", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/environments`,
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 403 without services:read scope", async () => {
      currentAuthContext = {
        accountId: testAccountId,
        scopes: ["builds:read"],
      };

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/environments`,
        headers: { authorization: "Bearer test-key" },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should return 404 for non-existent service", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${new ObjectId()}/environments`,
        headers: { authorization: "Bearer test-key" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 404 when account doesn't own service", async () => {
      const otherAccount = await accountRepo.create({
        name: "Other Org",
        slug: "other-org",
      });
      currentAuthContext = {
        accountId: otherAccount._id,
        scopes: ["services:read"],
      };

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/environments`,
        headers: { authorization: "Bearer test-key" },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /api/v1/services/:serviceId/environments", () => {
    it("should add a new environment", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/environments`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: { name: "dev", displayName: "Development" },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.environments).toHaveLength(3);
      expect(body.environments).toContainEqual(
        expect.objectContaining({ name: "dev", displayName: "Development" }),
      );
    });

    it("should return 400 for invalid name format", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/environments`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: { name: "Invalid Name", displayName: "Invalid" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain("lowercase alphanumeric");
    });

    it("should return 400 for duplicate name", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/environments`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: { name: "staging", displayName: "Another Staging" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain("already exists");
    });

    it("should return 400 when missing required fields", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/environments`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: { name: "dev" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain("required");
    });

    it("should return 403 without services:write scope", async () => {
      currentAuthContext = {
        accountId: testAccountId,
        scopes: ["services:read"],
      };

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/environments`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: { name: "dev", displayName: "Development" },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("PATCH /api/v1/services/:serviceId/environments/:envName", () => {
    it("should update environment displayName", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/services/${testServiceId}/environments/staging`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: { displayName: "Staging Environment" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const staging = body.environments.find(
        (e: { name: string }) => e.name === "staging",
      );
      expect(staging.displayName).toBe("Staging Environment");
    });

    it("should update environment order", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/services/${testServiceId}/environments/staging`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: { order: 5 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const staging = body.environments.find(
        (e: { name: string }) => e.name === "staging",
      );
      expect(staging.order).toBe(5);
    });

    it("should return 404 for non-existent environment", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/services/${testServiceId}/environments/nonexistent`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: { displayName: "New Name" },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /api/v1/services/:serviceId/environments/:envName", () => {
    it("should remove an environment", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/services/${testServiceId}/environments/staging`,
        headers: { authorization: "Bearer test-key" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.environments).toHaveLength(1);
      expect(
        body.environments.find((e: { name: string }) => e.name === "staging"),
      ).toBeUndefined();
    });

    it("should return 400 when trying to remove last environment", async () => {
      // First remove staging
      await app.inject({
        method: "DELETE",
        url: `/api/v1/services/${testServiceId}/environments/staging`,
        headers: { authorization: "Bearer test-key" },
      });

      // Try to remove prod (last one)
      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/services/${testServiceId}/environments/prod`,
        headers: { authorization: "Bearer test-key" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain("last environment");
    });

    it("should return 404 for non-existent environment", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/services/${testServiceId}/environments/nonexistent`,
        headers: { authorization: "Bearer test-key" },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
