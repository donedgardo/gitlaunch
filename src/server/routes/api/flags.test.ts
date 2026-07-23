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
import Fastify, {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { FlagRepository } from "../../../repositories/flagRepository";
import { FlagService } from "../../../services/flag/flagService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { registerFlagsRoutes } from "./flags";
import { ApiKeyScope } from "../../../repositories/apiKeyRepository";

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

const ALL_SCOPES: ApiKeyScope[] = ["flags:read", "flags:write"];

describe("Flags API Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let serviceRepo: ServiceRepository;
  let membershipRepo: MembershipRepository;
  let flagRepo: FlagRepository;
  let flagService: FlagService;
  let planEnforcementService: PlanEnforcementService;

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
    membershipRepo = new MembershipRepository(db);
    flagRepo = new FlagRepository(db);
    flagService = new FlagService(flagRepo, serviceRepo);
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
    if (app) await app.close();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("services").deleteMany({});
    await db.collection("flags").deleteMany({});

    const account = await accountRepo.create({
      name: "Test Org",
      slug: `test-org-${Date.now()}`,
    });
    testAccountId = account._id;
    const service = await serviceRepo.create({
      accountId: testAccountId,
      name: "backend",
    });
    testServiceId = service._id;

    currentAuthContext = { accountId: testAccountId, scopes: ALL_SCOPES };

    app = Fastify();
    app.addHook(
      "preHandler",
      createMockApiKeyAuth(() => currentAuthContext),
    );
    registerFlagsRoutes(app, {
      flagService,
      serviceRepo,
      planEnforcementService,
    });
    await app.ready();
  });

  function auth() {
    return {
      authorization: "Bearer test-key",
      "content-type": "application/json",
    };
  }

  it("should create, list, and fetch a flag", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/services/${testServiceId}/flags`,
      headers: auth(),
      payload: { key: "new-checkout", description: "New checkout" },
    });
    expect(create.statusCode).toBe(201);
    expect(JSON.parse(create.body).key).toBe("new-checkout");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/services/${testServiceId}/flags`,
      headers: auth(),
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).flags).toHaveLength(1);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/services/${testServiceId}/flags/new-checkout`,
      headers: auth(),
    });
    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.body).environments.staging.enabled).toBe(false);
  });

  it("should reject creation without flags:write scope", async () => {
    currentAuthContext = { accountId: testAccountId, scopes: ["flags:read"] };
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/services/${testServiceId}/flags`,
      headers: auth(),
      payload: { key: "x" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("should reject access to another account's service", async () => {
    const other = await accountRepo.create({
      name: "Other",
      slug: `other-${Date.now()}`,
    });
    const otherService = await serviceRepo.create({
      accountId: other._id,
      name: "svc",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/services/${otherService._id}/flags`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(403);
  });

  it("should configure an environment and evaluate deterministically", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/services/${testServiceId}/flags`,
      headers: auth(),
      payload: { key: "beta" },
    });

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/services/${testServiceId}/flags/beta/environments/prod`,
      headers: auth(),
      payload: { enabled: true, rolloutPercentage: 100 },
    });
    expect(patch.statusCode).toBe(200);

    const evalUrl = `/api/v1/services/${testServiceId}/environments/prod/flags/evaluate?entity=user-1`;
    const first = await app.inject({
      method: "GET",
      url: evalUrl,
      headers: auth(),
    });
    expect(first.statusCode).toBe(200);
    const firstBody = JSON.parse(first.body);
    expect(firstBody.flags.beta.enabled).toBe(true);

    const second = await app.inject({
      method: "GET",
      url: evalUrl,
      headers: auth(),
    });
    expect(JSON.parse(second.body)).toEqual(firstBody);
  });

  it("should require the entity query parameter for evaluation", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/services/${testServiceId}/environments/prod/flags/evaluate`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(400);
  });

  it("should delete a flag", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/services/${testServiceId}/flags`,
      headers: auth(),
      payload: { key: "temp" },
    });
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/services/${testServiceId}/flags/temp`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(204);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/services/${testServiceId}/flags/temp`,
      headers: auth(),
    });
    expect(detail.statusCode).toBe(404);
  });
});
