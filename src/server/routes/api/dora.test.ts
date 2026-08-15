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
import { BuildRepository } from "../../../repositories/buildRepository";
import { DoraMetricsService } from "../../../services/dora/doraMetricsService";
import { DeploymentStatus } from "../../../services/service/deploymentStatus";
import { ApiKeyScope } from "../../../repositories/apiKeyRepository";
import { registerDoraRoutes } from "./dora";

const HOUR = 60 * 60 * 1000;

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

describe("DORA API Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let serviceRepo: ServiceRepository;
  let buildRepo: BuildRepository;
  let doraMetricsService: DoraMetricsService;

  let testAccountId: ObjectId;
  let testServiceId: ObjectId;
  let currentAuthContext: { accountId: ObjectId; scopes: ApiKeyScope[] } | null;

  // A fixed "now" so a window of N days is the same window every run.
  const now = new Date("2026-08-11T00:00:00Z");

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");

    accountRepo = new AccountRepository(db);
    repoRepo = new RepositoryRepository(db);
    serviceRepo = new ServiceRepository(db);
    buildRepo = new BuildRepository(db);
    doraMetricsService = new DoraMetricsService(buildRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  /** A build with a hand-placed deployment history. */
  const givenBuild = async (
    buildId: string,
    createdAt: string,
    logs: Array<{
      environment: string;
      status: DeploymentStatus;
      at: string;
      intent?: "promote" | "rollback";
    }>,
    accountId: ObjectId = testAccountId,
  ) => {
    await db.collection("builds").insertOne({
      accountId,
      serviceId: testServiceId,
      buildId,
      deployments: {},
      deploymentLogs: logs.map((l) => ({
        environment: l.environment,
        status: l.status,
        at: new Date(l.at),
        ...(l.intent ? { intent: l.intent } : {}),
      })),
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    });
  };

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});
    await db.collection("services").deleteMany({});
    await db.collection("builds").deleteMany({});

    app = Fastify();
    app.addHook(
      "preHandler",
      createMockApiKeyAuth(() => currentAuthContext),
    );
    registerDoraRoutes(app, {
      doraMetricsService,
      serviceRepo,
      now: () => now,
    });
    await app.ready();

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

    currentAuthContext = {
      accountId: testAccountId,
      scopes: ["builds:read"],
    };
  });

  const get = (query: string) =>
    app.inject({
      method: "GET",
      url: `/api/v1/services/${testServiceId}/dora${query}`,
      headers: { authorization: "Bearer test-key" },
    });

  describe("GET /api/v1/services/:serviceId/dora", () => {
    it("should report the four keys for an environment", async () => {
      // Given: a build reported at 11:00 that went live at 12:00
      await givenBuild("v1", "2026-08-02T11:00:00Z", [
        {
          environment: "prod",
          status: DeploymentStatus.DEPLOYED,
          at: "2026-08-02T12:00:00Z",
          intent: "promote",
        },
      ]);

      // When: a key holder asks for prod over the last ten days
      const response = await get("?environment=prod&days=10");

      // Then: the numbers come back with the window they describe
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.environment).toBe("prod");
      expect(body.medianLeadTimeMs).toBe(1 * HOUR);
      expect(body.sample.deployments).toBe(1);
      expect(body.window.days).toBe(10);
      expect(new Date(body.window.to).toISOString()).toBe(now.toISOString());
    });

    it("should carry the denominators so a caller can judge the numbers", async () => {
      // Given: three deploys, one of which failed
      await givenBuild("v1", "2026-08-02T11:00:00Z", [
        {
          environment: "prod",
          status: DeploymentStatus.DEPLOYED,
          at: "2026-08-02T12:00:00Z",
          intent: "promote",
        },
      ]);
      await givenBuild("v2", "2026-08-04T11:00:00Z", [
        {
          environment: "prod",
          status: DeploymentStatus.ERROR,
          at: "2026-08-04T12:00:00Z",
          intent: "promote",
        },
      ]);
      await givenBuild("v3", "2026-08-06T11:00:00Z", [
        {
          environment: "prod",
          status: DeploymentStatus.DEPLOYED,
          at: "2026-08-06T12:00:00Z",
          intent: "promote",
        },
      ]);

      // When: we ask
      const response = await get("?environment=prod&days=10");

      // Then: the change failure rate never travels without its n
      const body = response.json();
      expect(body.changeFailureRate).toBeCloseTo(1 / 3);
      expect(body.sample).toEqual({
        deployments: 2,
        failures: 1,
        restores: 1,
        leadTimes: 2,
        // None of these builds reported a commit time, so the caller can see
        // the lead time is measured from when we heard about them
        leadTimesFromCommit: 0,
      });
    });

    it("should report an environment that has never deployed", async () => {
      // When: we ask about a service with no history
      const response = await get("?environment=prod&days=30");

      // Then: nulls rather than zeroes that read as perfect scores
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.medianLeadTimeMs).toBeNull();
      expect(body.changeFailureRate).toBeNull();
      expect(body.sample.deployments).toBe(0);
    });

    it("should default to the last 30 days when no window is given", async () => {
      const response = await get("?environment=prod");

      expect(response.statusCode).toBe(200);
      expect(response.json().window.days).toBe(30);
    });

    it("should reject an environment the service does not have", async () => {
      // When: a typo, or an environment that was removed
      const response = await get("?environment=nope&days=30");

      // Then: say so, rather than answer "you have never deployed", which is
      // indistinguishable from a real empty history
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/environment/i);
    });

    it("should require an environment", async () => {
      const response = await get("?days=30");

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/environment/i);
    });

    it("should reject a window that is not a sane number of days", async () => {
      expect((await get("?environment=prod&days=0")).statusCode).toBe(400);
      expect((await get("?environment=prod&days=-5")).statusCode).toBe(400);
      expect((await get("?environment=prod&days=abc")).statusCode).toBe(400);
      expect((await get("?environment=prod&days=100000")).statusCode).toBe(400);
    });

    it("should reject an invalid service id", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/services/not-an-id/dora?environment=prod",
        headers: { authorization: "Bearer test-key" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return 404 for a service that does not exist", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${new ObjectId()}/dora?environment=prod`,
        headers: { authorization: "Bearer test-key" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should not report another account's delivery", async () => {
      // Given: a key for a different account
      currentAuthContext = {
        accountId: new ObjectId(),
        scopes: ["builds:read"],
      };

      // When: it asks about our service
      const response = await get("?environment=prod&days=30");

      // Then: it is refused, not answered
      expect(response.statusCode).toBe(403);
    });

    it("should return 401 without an API key", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/dora?environment=prod`,
      });

      expect(response.statusCode).toBe(401);
    });

    it("should require builds:read", async () => {
      // Given: a key that can deploy but not read build history
      currentAuthContext = {
        accountId: testAccountId,
        scopes: ["deployments:write"],
      };

      // When: it asks for the metrics
      const response = await get("?environment=prod&days=30");

      // Then: refused — these numbers are the build history, aggregated
      expect(response.statusCode).toBe(403);
    });
  });
});
