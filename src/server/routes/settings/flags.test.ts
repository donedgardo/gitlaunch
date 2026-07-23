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
import { FlagService } from "../../../services/flag/flagService";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../../registerHandlebarsHelpers";
import { registerFlagsSettingsRoutes } from "./flags";

describe("Flags Settings Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let serviceRepo: ServiceRepository;
  let flagRepo: FlagRepository;
  let flagService: FlagService;
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

    accountRepo = new AccountRepository(db);
    serviceRepo = new ServiceRepository(db);
    flagRepo = new FlagRepository(db);
    flagService = new FlagService(flagRepo, serviceRepo);

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
        },
      },
    });
    sessionAuthMiddleware(app, sessionService);
    registerFlagsSettingsRoutes(app, {
      serviceRepository: serviceRepo,
      flagService,
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
});
