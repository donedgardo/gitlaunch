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
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { BuildRepository } from "../../../repositories/buildRepository";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../../registerHandlebarsHelpers";
import { registerSetupRoutes } from "./setup";

describe("Setup Wizard Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let serviceRepo: ServiceRepository;
  let buildRepo: BuildRepository;
  let sessionService: SessionService;

  const TEST_SECRET = "test-secret";
  const COOKIE_SECRET = "test-cookie";

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    registerHandlebarsHelpers();
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("services").deleteMany({});
    await db.collection("builds").deleteMany({});

    accountRepo = new AccountRepository(db);
    serviceRepo = new ServiceRepository(db);
    buildRepo = new BuildRepository(db);
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
          githubSecretsSetup: "/partials/githubSecretsSetup.hbs",
          buildReportingInstructions:
            "/partials/buildReportingInstructions.hbs",
          setupStep: "/partials/setupStep.hbs",
          deploymentSetupGuide: "/partials/deploymentSetupGuide.hbs",
          aiAgentSetup: "/partials/aiAgentSetup.hbs",
        },
      },
    });
    sessionAuthMiddleware(app, sessionService);
    registerSetupRoutes(app, {
      publicUrl: "http://localhost:3050",
      buildSimulationEnabled: false,
      serviceRepo,
      buildRepo,
    });
    await app.ready();
  });

  describe("GET /dashboard/:serviceName/setup/:step", () => {
    it("should return step 1 content with secrets setup", async () => {
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      await serviceRepo.create({
        accountId: account._id,
        repositoryId: new ObjectId(),
        name: "my-svc",
      });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/my-svc/setup/1",
        cookies: { session },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("GITLAUNCH_API_KEY");
      expect(res.body).toContain("Step 1 of 5");
    });

    it("should return step 2 content with CI workflow", async () => {
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      await serviceRepo.create({
        accountId: account._id,
        repositoryId: new ObjectId(),
        name: "my-svc",
      });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/my-svc/setup/2",
        cookies: { session },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("CI Workflow");
      expect(res.body).toContain("Step 2 of 5");
    });

    // A self-hosted install must never tell a customer to POST their build —
    // carrying their own API key in an Authorization header — at gitlaunch.dev.
    // Their builds would land in our database, not theirs, and their credential
    // would be handed to a third party they never meant to send it to.
    it("should point the build-report snippet at this instance, not the hosted one", async () => {
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      await serviceRepo.create({
        accountId: account._id,
        repositoryId: new ObjectId(),
        name: "my-svc",
      });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/my-svc/setup/2",
        cookies: { session },
      });

      expect(res.body).toContain("http://localhost:3050/api/v1/services/");
      expect(res.body).not.toContain("gitlaunch.dev");
    });

    // Same offer as the new-user onboarding: setting up build reporting by hand
    // is the fallback, not the only way in.
    it("should offer the AI agent handoff on the build-reporting step", async () => {
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: new ObjectId(),
        name: "my-svc",
      });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/my-svc/setup/2",
        cookies: { session },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Let an AI agent set this up");
      expect(res.body).toContain(
        "http://localhost:3050/skills/gitlaunch-onboarding/SKILL.md",
      );
      expect(res.body).toContain(service._id.toString());
    });

    it("should return step 3 content with push instructions", async () => {
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      await serviceRepo.create({
        accountId: account._id,
        repositoryId: new ObjectId(),
        name: "my-svc",
      });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/my-svc/setup/3",
        cookies: { session },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Push a Commit");
      expect(res.body).toContain("Step 3 of 5");
    });

    it("should return step 4 content with deploy workflow", async () => {
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      await serviceRepo.create({
        accountId: account._id,
        repositoryId: new ObjectId(),
        name: "my-svc",
      });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/my-svc/setup/4",
        cookies: { session },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Deploy Workflow");
      expect(res.body).toContain("Step 4 of 5");
    });

    // Same credential-exposure problem as the build-report snippet: the deploy
    // workflow PATCHes its status with the customer's API key in the header.
    it("should point the deploy workflow at this instance, not the hosted one", async () => {
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      await serviceRepo.create({
        accountId: account._id,
        repositoryId: new ObjectId(),
        name: "my-svc",
      });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/my-svc/setup/4",
        cookies: { session },
      });

      expect(res.body).toContain("http://localhost:3050/api/v1/services/");
      expect(res.body).not.toContain("gitlaunch.dev");
    });

    it("should return step 5 content with workflow selection", async () => {
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      await serviceRepo.create({
        accountId: account._id,
        repositoryId: new ObjectId(),
        name: "my-svc",
      });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/my-svc/setup/5",
        cookies: { session },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Select Deploy Workflow");
      expect(res.body).toContain("Step 5 of 5");
    });

    it("should redirect unauthenticated users", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/dashboard/my-svc/setup/1",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/auth/github");
    });

    it("should return 404 for invalid step number", async () => {
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      await serviceRepo.create({
        accountId: account._id,
        repositoryId: new ObjectId(),
        name: "my-svc",
      });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/my-svc/setup/99",
        cookies: { session },
      });

      expect(res.statusCode).toBe(404);
    });

    it("should return 404 when accessing another account's service", async () => {
      const otherAccount = await accountRepo.create({
        name: "Other",
        slug: "other",
      });
      await serviceRepo.create({
        accountId: otherAccount._id,
        repositoryId: new ObjectId(),
        name: "their-svc",
      });

      const myAccount = await accountRepo.create({
        name: "Mine",
        slug: "mine",
      });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: myAccount._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/their-svc/setup/1",
        cookies: { session },
      });

      expect(res.statusCode).toBe(404);
    });

    it("should return 404 for non-existent service", async () => {
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const res = await app.inject({
        method: "GET",
        url: "/dashboard/no-such-svc/setup/1",
        cookies: { session },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
