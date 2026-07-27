import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import cookie from "@fastify/cookie";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { AccountRepository } from "../../../repositories/accountRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { FlagRepository } from "../../../repositories/flagRepository";
import { ApiKeyRepository } from "../../../repositories/apiKeyRepository";
import { FlagService } from "../../../services/flag/flagService";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { AnalyticsEventRepository } from "../../../repositories/analyticsEventRepository";
import { ExperimentResultsService } from "../../../services/flag/experimentResultsService";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../../registerHandlebarsHelpers";
import { registerFlagsSettingsRoutes } from "./flags";
import { WarehouseAnalytics } from "../../../services/analytics/warehouseAnalytics";

describe("Flags Settings Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let serviceRepo: ServiceRepository;
  let flagRepo: FlagRepository;
  let flagService: FlagService;
  let apiKeyRepo: ApiKeyRepository;
  let apiKeyService: ApiKeyService;
  let analyticsEventRepo: AnalyticsEventRepository;
  let analytics: WarehouseAnalytics;
  let experimentResults: ExperimentResultsService;
  let sessionService: SessionService;

  let accountId: ObjectId;
  let serviceId: ObjectId;
  let userId: ObjectId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    registerHandlebarsHelpers();
    sessionService = new SessionService("test-secret");
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  function session(): string {
    return sessionService.createSession({ userId, accountId });
  }

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("services").deleteMany({});
    await db.collection("flags").deleteMany({});
    await db.collection("apiKeys").deleteMany({});
    await db.collection("analytics_events").deleteMany({});

    accountRepo = new AccountRepository(db);
    serviceRepo = new ServiceRepository(db);
    flagRepo = new FlagRepository(db);
    flagService = new FlagService(flagRepo, serviceRepo);
    apiKeyRepo = new ApiKeyRepository(db);
    apiKeyService = new ApiKeyService(apiKeyRepo, accountRepo);
    analyticsEventRepo = new AnalyticsEventRepository(db);
    experimentResults = new ExperimentResultsService(db);

    userId = new ObjectId();
    const account = await accountRepo.create({ name: "Acme", slug: "acme" });
    accountId = account._id;
    const service = await serviceRepo.create({ accountId, name: "backend" });
    serviceId = service._id;

    app = Fastify();
    await app.register(formbody);
    await app.register(cookie, { secret: "test-cookie-secret" });
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: {
        partials: {
          navigation: "/partials/navigation.hbs",
          flagList: "/partials/flagList.hbs",
          flagKeyResult: "/partials/flagKeyResult.hbs",
          experimentResults: "/partials/experimentResults.hbs",
        },
      },
    });
    sessionAuthMiddleware(app, sessionService);
    analytics = new WarehouseAnalytics(analyticsEventRepo);
    registerFlagsSettingsRoutes(app, {
      serviceRepository: serviceRepo,
      flagService,
      apiKeyService,
      experimentResults,
      analytics,
    });
    await app.ready();
  });

  it("redirects to auth when unauthenticated", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/services/${serviceId}/flags`,
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/auth/github");
  });

  describe("analytics attribution", () => {
    async function capturedEvent(name: string) {
      await analytics.flush();
      return db.collection("analytics_events").findOne({ event: name });
    }

    it("should record which account and which person created a flag", async () => {
      // Given someone creating a flag from the settings page
      await app.inject({
        method: "POST",
        url: `/services/${serviceId}/flags`,
        cookies: { session: session() },
        payload: { key: "ui-created-flag", description: "" },
      });

      // When I look at what the warehouse captured
      const event = await capturedEvent("flag_created");

      // Then the change is attributed to the tenant and to the person
      expect(event?.accountId?.toString()).toBe(accountId.toString());
      expect(event?.distinctId).toBe(userId.toString());
    });

    it("should record who minted a flag reader key", async () => {
      // Given someone minting a server key from the settings page
      await app.inject({
        method: "POST",
        url: `/services/${serviceId}/flags/keys`,
        cookies: { session: session() },
      });

      // When I look at what the warehouse captured
      const event = await capturedEvent("flag_client_key_created");

      // Then the key mint is attributed to the tenant and to the person
      expect(event?.accountId?.toString()).toBe(accountId.toString());
      expect(event?.distinctId).toBe(userId.toString());
    });
  });

  it("renders the flags page with the create form", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/services/${serviceId}/flags`,
      cookies: { session: session() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Feature Flags");
    expect(response.body).toContain("Add Flag");
  });

  it("creates a flag and returns the updated list partial", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/services/${serviceId}/flags`,
      cookies: { session: session() },
      payload: { key: "new-checkout", description: "New flow" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("new-checkout");

    const flags = await flagService.listFlags(accountId, serviceId);
    expect(flags).toHaveLength(1);
    expect(flags[0].key).toBe("new-checkout");
  });

  it("toggles an environment on via the HTMX patch", async () => {
    await flagService.createFlag(accountId, serviceId, {
      key: "beta",
      description: "",
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/services/${serviceId}/flags/beta/environments/prod`,
      cookies: { session: session() },
      payload: { enabled: "true", rolloutPercentage: "50" },
    });
    expect(response.statusCode).toBe(200);

    const flag = await flagService.getFlag(accountId, serviceId, "beta");
    expect(flag?.environments.prod.enabled).toBe(true);
    expect(flag?.environments.prod.rolloutPercentage).toBe(50);
  });

  it("surfaces a validation error for a bad flag key", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/services/${serviceId}/flags`,
      cookies: { session: session() },
      payload: { key: "Bad Key" },
    });
    // Partial re-renders with the error rather than 4xx (HTMX swaps on 200).
    expect(response.statusCode).toBe(200);
    expect(response.body.toLowerCase()).toContain("lowercase");
  });

  it("saves A/B variants for an environment via the variants form", async () => {
    await flagService.createFlag(accountId, serviceId, {
      key: "checkout",
      description: "",
    });

    const response = await app.inject({
      method: "PUT",
      url: `/services/${serviceId}/flags/checkout/environments/prod/variants`,
      cookies: { session: session() },
      payload: {
        variantKey: ["control", "treatment"],
        variantWeight: ["60", "40"],
      },
    });
    expect(response.statusCode).toBe(200);

    const flag = await flagService.getFlag(accountId, serviceId, "checkout");
    expect(flag?.environments.prod.variants).toEqual([
      { key: "control", weight: 60 },
      { key: "treatment", weight: 40 },
    ]);
  });

  it("skips blank variant rows when saving", async () => {
    await flagService.createFlag(accountId, serviceId, {
      key: "checkout",
      description: "",
    });

    const response = await app.inject({
      method: "PUT",
      url: `/services/${serviceId}/flags/checkout/environments/prod/variants`,
      cookies: { session: session() },
      payload: {
        variantKey: ["control", "", "treatment"],
        variantWeight: ["60", "", "40"],
      },
    });
    expect(response.statusCode).toBe(200);

    const flag = await flagService.getFlag(accountId, serviceId, "checkout");
    expect(flag?.environments.prod.variants).toEqual([
      { key: "control", weight: 60 },
      { key: "treatment", weight: 40 },
    ]);
  });

  it("surfaces a validation error when variant weights don't sum to 100", async () => {
    await flagService.createFlag(accountId, serviceId, {
      key: "checkout",
      description: "",
    });

    const response = await app.inject({
      method: "PUT",
      url: `/services/${serviceId}/flags/checkout/environments/prod/variants`,
      cookies: { session: session() },
      payload: {
        variantKey: ["control", "treatment"],
        variantWeight: ["60", "30"],
      },
    });
    // HTMX swaps on 200: partial re-renders with the error message.
    expect(response.statusCode).toBe(200);
    expect(response.body.toLowerCase()).toContain("sum to 100");

    const flag = await flagService.getFlag(accountId, serviceId, "checkout");
    expect(flag?.environments.prod.variants).toEqual([]);
  });

  it("clears variants back to a boolean flag when submitted empty", async () => {
    await flagService.createFlag(accountId, serviceId, {
      key: "checkout",
      description: "",
    });
    await flagService.setEnvConfig(accountId, serviceId, "checkout", "prod", {
      variants: [
        { key: "control", weight: 50 },
        { key: "treatment", weight: 50 },
      ],
    });

    const response = await app.inject({
      method: "PUT",
      url: `/services/${serviceId}/flags/checkout/environments/prod/variants`,
      cookies: { session: session() },
      payload: {},
    });
    expect(response.statusCode).toBe(200);

    const flag = await flagService.getFlag(accountId, serviceId, "checkout");
    expect(flag?.environments.prod.variants).toEqual([]);
  });

  it("renders an editable variants form for each environment", async () => {
    await flagService.createFlag(accountId, serviceId, {
      key: "checkout",
      description: "",
    });

    const response = await app.inject({
      method: "GET",
      url: `/services/${serviceId}/flags`,
      cookies: { session: session() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      `/flags/checkout/environments/prod/variants`,
    );
    expect(response.body).toContain(`name="variantKey"`);
    expect(response.body).toContain(`name="variantWeight"`);
  });

  it("renders a read-only targeting-rule summary on the flag card", async () => {
    await flagService.createFlag(accountId, serviceId, {
      key: "beta",
      description: "",
    });
    await flagService.setEnvConfig(accountId, serviceId, "beta", "prod", {
      enabled: true,
      targetingRules: [
        {
          conditions: [
            { attribute: "country", operator: "in", values: ["US", "CA"] },
          ],
          serve: null,
        },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: `/services/${serviceId}/flags`,
      cookies: { session: session() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("country in US, CA");
  });

  it("shows a 'Connect an app' panel with the evaluate endpoint for this service", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/services/${serviceId}/flags`,
      cookies: { session: session() },
    });
    expect(response.statusCode).toBe(200);
    // The panel surfaces the exact evaluate endpoint, serviceId pre-filled.
    expect(response.body).toContain(
      `/api/v1/services/${serviceId}/environments/`,
    );
    expect(response.body).toContain("flags/evaluate");
    // ...and a way to mint a client key without leaving the page.
    expect(response.body).toContain("/services/" + serviceId + "/flags/keys");
  });

  it("mints a read-only (flags:read only) key for the service, shown once", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/services/${serviceId}/flags/keys`,
      cookies: { session: session() },
    });
    expect(response.statusCode).toBe(200);
    // The raw key is returned once for the user to copy. It is a secret key —
    // sk_, not pk_ — because flags:read exposes rule config and results.
    expect(response.body).toContain("sk_acme_");

    // Security: the minted key is least-privilege — flags:read and NOTHING else.
    const keys = await apiKeyService.listByAccount(accountId);
    expect(keys).toHaveLength(1);
    expect(keys[0].scopes).toEqual(["flags:read"]);
    expect(keys[0].isRevoked).toBe(false);
  });

  it("mints a browser key confined to one service, environment and origin", async () => {
    // Given: a web app that will evaluate flags from the browser
    // When: I mint a browser key for it
    const response = await app.inject({
      method: "POST",
      url: `/services/${serviceId}/flags/keys/browser`,
      cookies: { session: session() },
      payload: { environment: "prod", origins: "https://app.example.com" },
    });

    // Then: I get a publishable key back, once
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("pk_acme_");

    // And: it can do nothing but evaluate this one service's prod flags, from
    // the origin I named — which is what makes it safe to ship in a bundle.
    const keys = await apiKeyService.listByAccount(accountId);
    expect(keys).toHaveLength(1);
    expect(keys[0].kind).toBe("publishable");
    expect(keys[0].scopes).toEqual(["flags:evaluate"]);
    expect(keys[0].serviceId?.toString()).toBe(serviceId.toString());
    expect(keys[0].environment).toBe("prod");
    expect(keys[0].allowedOrigins).toEqual(["https://app.example.com"]);
  });

  it("refuses to mint a browser key with no allowed origin", async () => {
    // Given: a request that names no origin
    // When: I try to mint a browser key
    const response = await app.inject({
      method: "POST",
      url: `/services/${serviceId}/flags/keys/browser`,
      cookies: { session: session() },
      payload: { environment: "prod", origins: "" },
    });

    // Then: nothing is minted — an origin-less browser key is usable anywhere
    expect(response.statusCode).toBe(400);
    expect(await apiKeyService.listByAccount(accountId)).toHaveLength(0);
  });

  it("does not mint a key for an unauthenticated request", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/services/${serviceId}/flags/keys`,
    });
    expect(response.statusCode).toBe(302);
    expect(await apiKeyService.listByAccount(accountId)).toHaveLength(0);
  });

  it("deletes a flag", async () => {
    await flagService.createFlag(accountId, serviceId, {
      key: "temp",
      description: "",
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/services/${serviceId}/flags/temp`,
      cookies: { session: session() },
    });
    expect(response.statusCode).toBe(200);
    expect(await flagService.getFlag(accountId, serviceId, "temp")).toBeNull();
  });

  describe("experiment results", () => {
    async function seedExposure(
      variant: string,
      distinctId: string,
      event = "flag_exposure",
    ) {
      await analyticsEventRepo.insert({
        type: "track",
        event,
        accountId,
        distinctId,
        properties: {
          serviceId: serviceId.toString(),
          flagKey: "exp",
          environment: "prod",
          variant,
        },
      });
    }

    it("renders per-variant conversion rates for a flag", async () => {
      await flagService.createFlag(accountId, serviceId, {
        key: "exp",
        description: "",
      });
      // control: 2 exposed, 1 converted => 50%
      await seedExposure("control", "u1");
      await seedExposure("control", "u2");
      await seedExposure("control", "u1", "flag_conversion");
      // treatment: 2 exposed, 2 converted => 100%
      await seedExposure("treatment", "u3");
      await seedExposure("treatment", "u4");
      await seedExposure("treatment", "u3", "flag_conversion");
      await seedExposure("treatment", "u4", "flag_conversion");

      const response = await app.inject({
        method: "GET",
        url: `/services/${serviceId}/flags/exp/results`,
        cookies: { session: session() },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("control");
      expect(response.body).toContain("treatment");
      expect(response.body).toContain("50.0%");
      expect(response.body).toContain("100.0%");
    });

    it("tells the customer whether the result can be acted on yet", async () => {
      await flagService.createFlag(accountId, serviceId, {
        key: "exp",
        description: "",
      });
      await seedExposure("control", "u1");
      await seedExposure("control", "u2");
      await seedExposure("control", "u1", "flag_conversion");
      await seedExposure("treatment", "u3");
      await seedExposure("treatment", "u4");
      await seedExposure("treatment", "u3", "flag_conversion");
      await seedExposure("treatment", "u4", "flag_conversion");

      const response = await app.inject({
        method: "GET",
        url: `/services/${serviceId}/flags/exp/results`,
        cookies: { session: session() },
      });

      // Four entities decide nothing, so the panel must say so rather than
      // letting the raw 50% vs 100% read as a winner.
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Keep running");
      expect(response.body).toContain("more per arm");
    });

    it("returns 404 for results of an unknown flag", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/services/${serviceId}/flags/ghost/results`,
        cookies: { session: session() },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
