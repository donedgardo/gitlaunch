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
import { AccountLimits } from "../../../services/limits/accountPolicy";
import { OpenCoreLimits } from "../../../services/limits/openCorePolicy";
import { AnalyticsEventRepository } from "../../../repositories/analyticsEventRepository";
import { WarehouseAnalytics } from "../../../services/analytics/warehouseAnalytics";
import { ExperimentResultsService } from "../../../services/flag/experimentResultsService";
import { FlagConfigVersionRepository } from "../../../repositories/flagConfigVersionRepository";
import { FlagConfigVersionService } from "../../../services/flag/flagConfigVersionService";
import { registerFlagsRoutes } from "./flags";
import { ApiKeyScope } from "../../../repositories/apiKeyRepository";

type MockAuthContext = {
  accountId: ObjectId;
  scopes: ApiKeyScope[];
  kind?: "secret" | "publishable";
  serviceId?: ObjectId | null;
  environment?: string | null;
  allowedOrigins?: string[];
  allowedEnvironments?: string[];
};

function createMockApiKeyAuth(getContext: () => MockAuthContext | null) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Mirrors the real middleware: a CORS preflight carries no credentials.
    if (request.method === "OPTIONS") return;
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
      kind: context.kind ?? "secret",
      serviceId: context.serviceId ?? null,
      environment: context.environment ?? null,
      allowedOrigins: context.allowedOrigins ?? [],
      allowedEnvironments: context.allowedEnvironments ?? null,
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
  let planEnforcementService: AccountLimits;
  let analytics: WarehouseAnalytics;
  let experimentResults: ExperimentResultsService;
  let configVersions: FlagConfigVersionService;

  let testAccountId: ObjectId;
  let testServiceId: ObjectId;
  let currentAuthContext: MockAuthContext | null;

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
    configVersions = new FlagConfigVersionService(
      flagRepo,
      new FlagConfigVersionRepository(db),
    );
    flagService = new FlagService(
      flagRepo,
      serviceRepo,
      undefined,
      configVersions,
    );
    analytics = new WarehouseAnalytics(new AnalyticsEventRepository(db));
    experimentResults = new ExperimentResultsService(db);
    planEnforcementService = new OpenCoreLimits({
      accountRepository: accountRepo,
      repositoryRepository: repoRepo,
      serviceRepository: serviceRepo,
      membershipRepository: membershipRepo,
    });
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
    await db.collection("analytics_events").deleteMany({});
    await db.collection("flag_config_versions").deleteMany({});

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
      analytics,
      experimentResults,
      configVersions,
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

  it("should answer a CORS preflight for evaluate so a browser can call it", async () => {
    // Given: a browser about to send an authorized cross-origin GET. It sends
    // the preflight first, with no credentials of any kind.
    const response = await app.inject({
      method: "OPTIONS",
      url: `/api/v1/services/${testServiceId}/environments/prod/flags/evaluate`,
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });

    // Then: it is answered rather than 401'd, and permits the Authorization
    // header the real request will carry. The preflight is not a security
    // boundary — the key's own origin allow-list is enforced on the GET.
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://app.example.com",
    );
    expect(
      String(response.headers["access-control-allow-headers"]).toLowerCase(),
    ).toContain("authorization");
    expect(String(response.headers["access-control-allow-methods"])).toContain(
      "GET",
    );
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

  it("should apply targeting rules from attr.* query params on evaluation", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/services/${testServiceId}/flags`,
      headers: auth(),
      payload: { key: "beta" },
    });

    // Rollout is 0 — only the targeting rule can turn the flag on.
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/services/${testServiceId}/flags/beta/environments/prod`,
      headers: auth(),
      payload: {
        enabled: true,
        rolloutPercentage: 0,
        targetingRules: [
          {
            conditions: [
              { attribute: "country", operator: "in", values: ["US", "CA"] },
            ],
            serve: null,
          },
        ],
      },
    });
    expect(patch.statusCode).toBe(200);

    const base = `/api/v1/services/${testServiceId}/environments/prod/flags/evaluate?entity=user-1`;

    const matched = await app.inject({
      method: "GET",
      url: `${base}&attr.country=US`,
      headers: auth(),
    });
    expect(JSON.parse(matched.body).flags.beta.enabled).toBe(true);
    expect(JSON.parse(matched.body).flags.beta.reason).toBe("targeting_rule");

    const unmatched = await app.inject({
      method: "GET",
      url: `${base}&attr.country=DE`,
      headers: auth(),
    });
    expect(JSON.parse(unmatched.body).flags.beta.enabled).toBe(false);
  });

  it("should reject an invalid targeting rule on configure", async () => {
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
      payload: {
        enabled: true,
        targetingRules: [{ conditions: [], serve: null }],
      },
    });
    expect(patch.statusCode).toBe(400);
  });

  it("should attribute a conversion using targeting attributes", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/services/${testServiceId}/flags`,
      headers: auth(),
      payload: { key: "exp" },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/services/${testServiceId}/flags/exp/environments/prod`,
      headers: auth(),
      payload: {
        enabled: true,
        rolloutPercentage: 0,
        variants: [
          { key: "control", weight: 50 },
          { key: "treatment", weight: 50 },
        ],
        targetingRules: [
          {
            conditions: [
              { attribute: "country", operator: "eq", values: ["US"] },
            ],
            serve: "treatment",
          },
        ],
      },
    });

    const conv = await app.inject({
      method: "POST",
      url: `/api/v1/services/${testServiceId}/environments/prod/flags/exp/conversions`,
      headers: auth(),
      payload: { entity: "user-1", attributes: { country: "US" } },
    });
    expect(conv.statusCode).toBe(201);
    expect(JSON.parse(conv.body).variant).toBe("treatment");
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

  describe("analytics attribution", () => {
    async function capturedEvent(name: string) {
      await analytics.flush();
      return db.collection("analytics_events").findOne({ event: name });
    }

    it("should record which account and which key created a flag", async () => {
      // Given a key creating a flag over the API
      await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/flags`,
        headers: auth(),
        payload: { key: "attributed-flag", description: "" },
      });

      // When I look at what the warehouse captured
      const event = await capturedEvent("flag_created");

      // Then the change is attributed to a tenant and to the key that made it
      expect(event?.accountId?.toString()).toBe(testAccountId.toString());
      expect(event?.distinctId).toMatch(/^apikey:/);
    });

    it("should record which account and which key updated a flag", async () => {
      // Given an existing flag being reconfigured over the API
      await flagService.createFlag(testAccountId, testServiceId, {
        key: "updatable",
        description: "",
      });
      await app.inject({
        method: "PATCH",
        url: `/api/v1/services/${testServiceId}/flags/updatable/environments/prod`,
        headers: auth(),
        payload: { enabled: true, rolloutPercentage: 50 },
      });

      // When I look at what the warehouse captured
      const event = await capturedEvent("flag_updated");

      // Then the change is attributed to a tenant and to the key that made it
      expect(event?.accountId?.toString()).toBe(testAccountId.toString());
      expect(event?.distinctId).toMatch(/^apikey:/);
    });
  });

  describe("experiment metrics", () => {
    async function enableExperiment(key: string) {
      await flagService.createFlag(testAccountId, testServiceId, {
        key,
        description: "",
      });
      await flagService.setEnvConfig(
        testAccountId,
        testServiceId,
        key,
        "prod",
        {
          enabled: true,
          rolloutPercentage: 100,
          variants: [
            { key: "control", weight: 50 },
            { key: "treatment", weight: 50 },
          ],
        },
      );
    }

    function evaluate(entity: string, env = "prod") {
      const url = `/api/v1/services/${testServiceId}/environments/${env}/flags/evaluate?entity=${entity}`;
      return app.inject({ method: "GET", url, headers: auth() });
    }

    function convert(key: string, entity: string, extra: object = {}) {
      return app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/environments/prod/flags/${key}/conversions`,
        headers: auth(),
        payload: { entity, ...extra },
      });
    }

    function fetchResults(key: string) {
      return app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/environments/prod/flags/${key}/results`,
        headers: auth(),
      });
    }

    it("records exposures on evaluation and conversions, then reports per-variant results", async () => {
      await enableExperiment("exp");

      const entities = ["u1", "u2", "u3", "u4", "u5", "u6"];
      for (const e of entities) await evaluate(e);

      for (const e of ["u1", "u2", "u3"]) {
        const c = await convert("exp", e);
        expect(c.statusCode).toBe(201);
        const body = JSON.parse(c.body);
        expect(body.recorded).toBe(true);
        expect(body).toHaveProperty("variant");
      }
      await analytics.flush();

      const res = await fetchResults("exp");
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.flagKey).toBe("exp");

      const totalExposures = body.variants.reduce(
        (s: number, v: any) => s + v.exposures,
        0,
      );
      const totalConversions = body.variants.reduce(
        (s: number, v: any) => s + v.conversions,
        0,
      );
      expect(totalExposures).toBe(6);
      expect(totalConversions).toBe(3);
      expect(body.totals.exposures).toBe(6);
      // Rates are conversions/exposures per variant.
      for (const v of body.variants) {
        expect(v.conversionRate).toBeCloseTo(v.conversions / v.exposures, 5);
      }
    });

    it("attributes a conversion to the same variant the entity was assigned", async () => {
      await enableExperiment("exp");

      const evalRes = await evaluate("stable-user");
      const assigned = JSON.parse(evalRes.body).flags.exp.variant;

      const c = await convert("exp", "stable-user");
      expect(JSON.parse(c.body).variant).toBe(assigned);
    });

    it("does not record exposures for a disabled flag", async () => {
      await flagService.createFlag(testAccountId, testServiceId, {
        key: "off",
        description: "",
      });
      await evaluate("u1");
      await analytics.flush();

      const res = await fetchResults("off");
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).totals.exposures).toBe(0);
    });

    it("rejects a conversion without an entity", async () => {
      await enableExperiment("exp");
      const c = await app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/environments/prod/flags/exp/conversions`,
        headers: auth(),
        payload: {},
      });
      expect(c.statusCode).toBe(400);
    });

    it("returns 404 converting or fetching results for an unknown flag", async () => {
      const c = await convert("ghost", "u1");
      expect(c.statusCode).toBe(404);
      const r = await fetchResults("ghost");
      expect(r.statusCode).toBe(404);
    });

    it("requires flags:read scope to record a conversion", async () => {
      await enableExperiment("exp");
      currentAuthContext = {
        accountId: testAccountId,
        scopes: ["flags:write"],
      };
      const c = await convert("exp", "u1");
      expect(c.statusCode).toBe(403);
    });

    // A front-end experiment is exposure + conversion. A browser key that can
    // only do the first half reports 0% for every arm forever, so the results
    // panel can never call a winner.
    describe("from the browser", () => {
      const ORIGIN = "https://app.example.com";

      function browserKey(overrides: Partial<MockAuthContext> = {}) {
        currentAuthContext = {
          accountId: testAccountId,
          scopes: ["flags:evaluate"],
          kind: "publishable",
          serviceId: testServiceId,
          environment: "prod",
          allowedOrigins: [ORIGIN],
          ...overrides,
        };
      }

      function browserConvert(key: string, entity: string, origin = ORIGIN) {
        return app.inject({
          method: "POST",
          url: `/api/v1/services/${testServiceId}/environments/prod/flags/${key}/conversions`,
          headers: { ...auth(), origin },
          payload: { entity },
        });
      }

      it("records a conversion for the service and environment it is bound to", async () => {
        await enableExperiment("exp");
        const evalRes = await app.inject({
          method: "GET",
          url: `/api/v1/services/${testServiceId}/environments/prod/flags/evaluate?entity=web-user`,
          headers: { ...auth(), origin: ORIGIN },
        });
        browserKey();
        const assigned = JSON.parse(evalRes.body).flags.exp.variant;

        const c = await browserConvert("exp", "web-user");
        expect(c.statusCode).toBe(201);
        expect(JSON.parse(c.body).variant).toBe(assigned);
        expect(c.headers["access-control-allow-origin"]).toBe(ORIGIN);
      });

      it("refuses a conversion for an environment the key is not bound to", async () => {
        await enableExperiment("exp");
        browserKey({ environment: "staging" });
        const c = await browserConvert("exp", "web-user");
        expect(c.statusCode).toBe(403);
      });

      it("refuses a conversion from an origin outside the allow-list", async () => {
        await enableExperiment("exp");
        browserKey();
        const c = await browserConvert("exp", "web-user", "https://evil.test");
        expect(c.statusCode).toBe(403);
      });

      it("answers the CORS preflight so the browser will send the conversion", async () => {
        const preflight = await app.inject({
          method: "OPTIONS",
          url: `/api/v1/services/${testServiceId}/environments/prod/flags/exp/conversions`,
          headers: {
            origin: ORIGIN,
            "access-control-request-method": "POST",
          },
        });
        expect(preflight.statusCode).toBe(204);
        expect(preflight.headers["access-control-allow-origin"]).toBe(ORIGIN);
        expect(preflight.headers["access-control-allow-methods"]).toContain(
          "POST",
        );
      });
    });
  });

  describe("config versions", () => {
    async function createFlag(key: string) {
      return app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/flags`,
        headers: auth(),
        payload: { key, description: "" },
      });
    }

    async function setProd(
      key: string,
      body: { enabled?: boolean; rolloutPercentage?: number },
    ) {
      return app.inject({
        method: "PATCH",
        url: `/api/v1/services/${testServiceId}/flags/${key}/environments/prod`,
        headers: auth(),
        payload: body,
      });
    }

    function listVersions(env: string) {
      return app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/environments/${env}/config/versions`,
        headers: auth(),
      });
    }

    function getVersion(env: string, version: string) {
      return app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/environments/${env}/config/versions/${version}`,
        headers: auth(),
      });
    }

    it("should list config versions newest-first after config changes", async () => {
      await createFlag("new-checkout"); // v1 (prod + staging)
      await setProd("new-checkout", { enabled: true, rolloutPercentage: 100 }); // prod v2

      const res = await listVersions("prod");
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.environment).toBe("prod");
      expect(body.versions.map((v: { version: number }) => v.version)).toEqual([
        2, 1,
      ]);
      // List is metadata only — no full bundle payload.
      expect(body.versions[0].hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should fetch a specific immutable version artifact", async () => {
      await createFlag("new-checkout");
      await setProd("new-checkout", { enabled: true, rolloutPercentage: 100 });

      const res = await getVersion("prod", "1");
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.version).toBe(1);
      // v1 captured the safe-off seed, unaffected by the later change.
      expect(body.bundle.flags[0].config.enabled).toBe(false);
    });

    it("should resolve 'latest' to the newest version", async () => {
      await createFlag("new-checkout");
      await setProd("new-checkout", { enabled: true, rolloutPercentage: 100 });

      const res = await getVersion("prod", "latest");
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).version).toBe(2);
    });

    it("should 404 for a version that does not exist", async () => {
      await createFlag("new-checkout");
      const res = await getVersion("prod", "999");
      expect(res.statusCode).toBe(404);
    });

    it("should require flags:read scope", async () => {
      await createFlag("new-checkout");
      currentAuthContext = { accountId: testAccountId, scopes: [] };
      const res = await listVersions("prod");
      expect(res.statusCode).toBe(403);
    });

    it("should not expose another account's config versions", async () => {
      const other = await accountRepo.create({
        name: "Other",
        slug: `other-cv-${Date.now()}`,
      });
      const otherService = await serviceRepo.create({
        accountId: other._id,
        name: "svc",
      });
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/services/${otherService._id}/environments/prod/config/versions`,
        headers: auth(),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("keys limited to certain environments", () => {
    const limited = () => {
      currentAuthContext = {
        accountId: testAccountId,
        scopes: ALL_SCOPES,
        allowedEnvironments: ["staging"],
      };
    };
    const createFlag = (key: string) =>
      app.inject({
        method: "POST",
        url: `/api/v1/services/${testServiceId}/flags`,
        headers: auth(),
        payload: { key },
      });
    const configure = (key: string, env: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/v1/services/${testServiceId}/flags/${key}/environments/${env}`,
        headers: auth(),
        payload: { enabled: true, rolloutPercentage: 100 },
      });

    it("should switch a flag in an environment the key is allowed to act on", async () => {
      await createFlag("beta");
      limited();

      const res = await configure("beta", "staging");

      expect(res.statusCode).toBe(200);
    });

    it("should refuse to switch a flag in an environment outside the key's list", async () => {
      await createFlag("beta");
      limited();

      const res = await configure("beta", "prod");

      expect(res.statusCode).toBe(403);
      currentAuthContext = { accountId: testAccountId, scopes: ALL_SCOPES };
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/flags/beta`,
        headers: auth(),
      });
      expect(JSON.parse(detail.body).environments.prod.enabled).toBe(false);
    });

    it("should refuse to delete a flag, since that removes it from every environment", async () => {
      await createFlag("beta");
      limited();

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/services/${testServiceId}/flags/beta`,
        headers: auth(),
      });

      expect(res.statusCode).toBe(403);
    });

    it("should still create a flag, which starts switched off everywhere", async () => {
      limited();

      const res = await createFlag("fresh");

      expect(res.statusCode).toBe(201);
    });
  });
});
