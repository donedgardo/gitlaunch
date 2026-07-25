import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import EventEmitter from "node:events";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { BuildRepository } from "../../../repositories/buildRepository";
import { BuildService } from "../../../services/build/buildService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { registerBuildsRoutes } from "./builds";
import { WarehouseAnalytics } from "../../../services/analytics/warehouseAnalytics";
import { AnalyticsEventRepository } from "../../../repositories/analyticsEventRepository";
import { BuildDispatchServiceI } from "../../../services/build/buildDispatchService";
import { DeploymentStatus } from "../../../services/service/deploymentStatus";
import { ApiKeyScope } from "../../../repositories/apiKeyRepository";
import { Plan } from "../../../repositories/accountRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";

// Simple mock auth middleware for testing - simulates API key validation
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
      kind: "secret",
      allowedOrigins: [],
    };
  };
}

describe("Builds API Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let analytics: WarehouseAnalytics;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let serviceRepo: ServiceRepository;
  let buildRepo: BuildRepository;
  let buildService: BuildService;
  let planEnforcementService: PlanEnforcementService;
  let membershipRepo: MembershipRepository;
  let mockDispatcher: BuildDispatchServiceI;
  let eventEmitter: EventEmitter;

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
    buildRepo = new BuildRepository(db);
    eventEmitter = new EventEmitter();
    mockDispatcher = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    };

    membershipRepo = new MembershipRepository(db);
    buildService = new BuildService(
      buildRepo,
      serviceRepo,
      eventEmitter,
      mockDispatcher,
    );
    planEnforcementService = new PlanEnforcementService(
      accountRepo,
      repoRepo,
      serviceRepo,
      membershipRepo,
    );
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});
    await db.collection("services").deleteMany({});
    await db.collection("builds").deleteMany({});
    vi.clearAllMocks();

    // Create test account, repository, and service
    const account = await accountRepo.create({
      name: "Test Org",
      slug: `test-org-${Date.now()}`,
    });
    testAccountId = account._id;

    const repository = await repoRepo.create({
      accountId: testAccountId,
      githubRepoId: 123,
      githubFullName: "org/repo",
      githubOwner: "org",
      githubRepoName: "repo",
      isPrivate: false,
    });

    const service = await serviceRepo.create({
      accountId: testAccountId,
      repositoryId: repository._id,
      name: "backend",
    });
    testServiceId = service._id;

    // Default auth context with all scopes
    currentAuthContext = {
      accountId: testAccountId,
      scopes: ["builds:read", "builds:write", "deployments:write"],
    };

    // Create fresh Fastify instance for each test
    app = Fastify();

    // Add mock API key auth middleware
    const mockAuth = createMockApiKeyAuth(() => currentAuthContext);
    app.addHook("preHandler", mockAuth);

    // Register routes
    analytics = new WarehouseAnalytics(new AnalyticsEventRepository(db));
    await db.collection("analytics_events").deleteMany({});
    registerBuildsRoutes(app, {
      buildService,
      serviceRepo,
      planEnforcementService,
      analytics,
    });

    await app.ready();
  });

  describe("analytics attribution", () => {
    it("should record which account and which key reported a build", async () => {
      // Given a CI key reporting a build
      await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: { buildId: "build-attribution-1" },
      });
      await analytics.flush();

      // When I look at what the warehouse captured
      const event = await db
        .collection("analytics_events")
        .findOne({ event: "build_reported" });

      // Then the build is attributed to a tenant and to the key that did it,
      // so it can appear in funnels and per-actor usage
      expect(event?.accountId?.toString()).toBe(testAccountId.toString());
      expect(event?.distinctId).toMatch(/^apikey:/);
    });
  });

  describe("POST /api/v1/services/:serviceId/builds", () => {
    it("should create a build with valid API key and builds:write scope", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: {
          buildId: "abc123",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.buildId).toBe("abc123");
      expect(body.accountId).toBe(testAccountId.toString());
    });

    it("should reject without API key", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds`,
        headers: {
          "content-type": "application/json",
        },
        payload: {
          buildId: "abc123",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject with invalid API key", async () => {
      // Set auth context to null to simulate invalid key
      currentAuthContext = null;

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds`,
        headers: {
          authorization: "Bearer invalid-key",
          "content-type": "application/json",
        },
        payload: {
          buildId: "abc123",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject without builds:write scope", async () => {
      // Set scopes to only builds:read
      currentAuthContext = {
        accountId: testAccountId,
        scopes: ["builds:read"],
      };

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: {
          buildId: "abc123",
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should reject when service belongs to different account", async () => {
      // Create another account and set it as the auth context
      const otherAccount = await accountRepo.create({
        name: "Other Org",
        slug: `other-org-${Date.now()}`,
      });

      currentAuthContext = {
        accountId: otherAccount._id,
        scopes: ["builds:read", "builds:write"],
      };

      // Try to create build for a service that belongs to testAccountId
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: {
          buildId: "abc123",
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("GET /api/v1/services/:serviceId/builds", () => {
    it("should list builds with builds:read scope", async () => {
      // Create some builds
      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "build-1",
      });
      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "build-2",
      });

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/builds`,
        headers: {
          authorization: "Bearer test-key",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.builds).toHaveLength(2);
    });

    it("should reject without builds:read scope", async () => {
      // Set scopes to only deployments:write
      currentAuthContext = {
        accountId: testAccountId,
        scopes: ["deployments:write"],
      };

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/builds`,
        headers: {
          authorization: "Bearer test-key",
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("GET /api/v1/services/:serviceId/builds/:buildId", () => {
    it("should get build details with builds:read scope", async () => {
      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "get-me",
      });

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/builds/get-me`,
        headers: {
          authorization: "Bearer test-key",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.buildId).toBe("get-me");
    });

    it("should return 404 when build not found", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/builds/non-existent`,
        headers: {
          authorization: "Bearer test-key",
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /api/v1/services/:serviceId/builds/:buildId/deploy/:env", () => {
    it("should trigger deployment with deployments:write scope", async () => {
      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "deploy-me",
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds/deploy-me/deploy/staging`,
        headers: {
          authorization: "Bearer test-key",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.deployments["staging"]).toBe(DeploymentStatus.DISPATCHING);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        testAccountId,
        testServiceId,
        "deploy-me",
        "staging",
      );
    });

    it("should reject without deployments:write scope", async () => {
      currentAuthContext = {
        accountId: testAccountId,
        scopes: ["builds:read"],
      };

      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "deploy-me-2",
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds/deploy-me-2/deploy/staging`,
        headers: {
          authorization: "Bearer test-key",
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should reject invalid environment", async () => {
      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "invalid-env",
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds/invalid-env/deploy/invalid`,
        headers: {
          authorization: "Bearer test-key",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("PATCH /api/v1/services/:serviceId/builds/:buildId/deploy/:env", () => {
    it("should update deployment status with deployments:write scope", async () => {
      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "update-me",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/services/${testServiceId}/builds/update-me/deploy/staging`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: {
          status: "deployed",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.deployments["staging"]).toBe(DeploymentStatus.DEPLOYED);
    });

    it("should reject invalid status", async () => {
      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "invalid-status",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/services/${testServiceId}/builds/invalid-status/deploy/staging`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: {
          status: "invalid-status",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("Read-only account blocking", () => {
    const makeAccountReadOnly = async () => {
      // Set paymentFailedAt to 8 days ago (past 7-day grace period)
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      await db
        .collection("accounts")
        .updateOne(
          { _id: testAccountId },
          { $set: { paymentFailedAt: eightDaysAgo, plan: Plan.Pro } },
        );
    };

    it("should block creating builds when account is read-only", async () => {
      await makeAccountReadOnly();

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: {
          buildId: "blocked-build",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toContain("read-only");
    });

    it("should block triggering deployments when account is read-only", async () => {
      // Create a build first (before making read-only)
      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "deploy-blocked",
      });

      await makeAccountReadOnly();

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/builds/deploy-blocked/deploy/staging`,
        headers: {
          authorization: "Bearer test-key",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toContain("read-only");
    });

    it("should block updating deployment status when account is read-only", async () => {
      // Create a build first (before making read-only)
      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "status-blocked",
      });

      await makeAccountReadOnly();

      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/services/${testServiceId}/builds/status-blocked/deploy/staging`,
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        payload: {
          status: "deployed",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toContain("read-only");
    });

    it("should allow read operations when account is read-only", async () => {
      // Create a build first (before making read-only)
      await buildService.createBuild({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "readable",
      });

      await makeAccountReadOnly();

      // GET list builds should still work
      const listResponse = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/builds`,
        headers: {
          authorization: "Bearer test-key",
        },
      });
      expect(listResponse.statusCode).toBe(200);

      // GET build details should still work
      const detailResponse = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/builds/readable`,
        headers: {
          authorization: "Bearer test-key",
        },
      });
      expect(detailResponse.statusCode).toBe(200);
    });
  });
});
