import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import EventEmitter from "node:events";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { BuildRepository } from "../../repositories/buildRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { SessionService } from "../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../registerHandlebarsHelpers";
import { BuildService } from "../../services/build/buildService";
import { BuildDispatchServiceI } from "../../services/build/buildDispatchService";
import dashboardRoutes from "./index";

describe("Dashboard Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let serviceRepo: ServiceRepository;
  let buildRepo: BuildRepository;
  let repositoryRepo: RepositoryRepository;
  let sessionService: SessionService;
  let buildService: BuildService;
  let mockDispatcher: BuildDispatchServiceI;
  let eventEmitter: EventEmitter;

  const TEST_SECRET = "test-secret-for-sessions";
  const COOKIE_SECRET = "test-cookie-secret";

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
    await db.collection("services").deleteMany({});
    await db.collection("builds").deleteMany({});
    await db.collection("repositories").deleteMany({});
    vi.clearAllMocks();

    serviceRepo = new ServiceRepository(db);
    buildRepo = new BuildRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    sessionService = new SessionService(TEST_SECRET);
    eventEmitter = new EventEmitter();
    mockDispatcher = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    };
    buildService = new BuildService(
      buildRepo,
      serviceRepo,
      eventEmitter,
      mockDispatcher,
    );

    app = Fastify();
    await app.register(cookie, { secret: COOKIE_SECRET });
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../templates"),
      options: {
        partials: {
          buildEnvironmentAction: "/partials/buildEnvironmentAction.hbs",
          buildReportingInstructions:
            "/partials/buildReportingInstructions.hbs",
          navigation: "/partials/navigation.hbs",
          buildRow: "/partials/buildRow.hbs",
          buildTable: "/partials/buildTable.hbs",
          emptyBuilds: "/partials/emptyBuilds.hbs",
          deploymentSetupGuide: "/partials/deploymentSetupGuide.hbs",
          githubSecretsSetup: "/partials/githubSecretsSetup.hbs",
        },
      },
    });
    sessionAuthMiddleware(app, sessionService);
    app.register(
      dashboardRoutes({
        serviceRepository: serviceRepo,
        buildRepository: buildRepo,
        repositoryRepository: repositoryRepo,
        buildService,
      }),
    );
    await app.ready();
  });

  describe("GET /dashboard/:serviceName", () => {
    it("should show a 'New Service' link in navigation when services exist", async () => {
      // Given: an authenticated user with a service
      const accountId = new ObjectId();
      const userId = new ObjectId();
      const repositoryId = new ObjectId();

      // Create a repository first
      await db.collection("repositories").insertOne({
        _id: repositoryId,
        accountId,
        githubId: 12345,
        githubFullName: "my-org/my-repo",
        name: "my-repo",
        owner: "my-org",
        private: false,
        createdAt: new Date(),
      });

      // Create a service
      await serviceRepo.create({
        accountId,
        repositoryId,
        name: "my-service",
        environments: [
          { name: "staging", order: 0 },
          { name: "prod", order: 1 },
        ],
      });

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting /dashboard/:serviceName
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/my-service",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response contains href="/services/new"
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('href="/services/new"');
    });

    it("should show deployment setup guide when builds exist but workflow not configured", async () => {
      // Given: service with builds, workflow not configured
      const accountId = new ObjectId();
      const userId = new ObjectId();
      const repositoryId = new ObjectId();

      await db.collection("repositories").insertOne({
        _id: repositoryId,
        accountId,
        githubId: 12345,
        githubFullName: "my-org/my-repo",
        name: "my-repo",
        owner: "my-org",
        private: false,
        createdAt: new Date(),
      });

      // Service is created with workflowConfigured=false by default
      const service = await serviceRepo.create({
        accountId,
        repositoryId,
        name: "needs-setup-service",
        environments: [
          { name: "staging", order: 0 },
          { name: "prod", order: 1 },
        ],
      });

      // Create a build
      await buildRepo.create({
        accountId,
        serviceId: service._id,
        buildId: "abc123",
      });

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting dashboard
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/needs-setup-service",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response contains deployment workflow instructions
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Create Your Deploy Workflow");
    });

    it("should not show deployment setup guide when workflow is configured", async () => {
      // Given: service with builds and workflow configured
      const accountId = new ObjectId();
      const userId = new ObjectId();
      const repositoryId = new ObjectId();

      await db.collection("repositories").insertOne({
        _id: repositoryId,
        accountId,
        githubId: 12345,
        githubFullName: "my-org/my-repo",
        name: "my-repo",
        owner: "my-org",
        private: false,
        createdAt: new Date(),
      });

      const service = await serviceRepo.create({
        accountId,
        repositoryId,
        name: "has-workflow-configured",
        environments: [
          { name: "staging", order: 0 },
          { name: "prod", order: 1 },
        ],
      });

      // Mark workflow as configured
      await serviceRepo.updateWorkflowConfiguration(service._id, {
        workflowFile: "deploy.yml",
        eventType: "deployment",
      });

      // Create a build
      await buildRepo.create({
        accountId,
        serviceId: service._id,
        buildId: "abc123",
      });

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting dashboard
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/has-workflow-configured",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response does NOT contain deployment setup guide
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("Configure Deployment Workflow");
      // And: it shows the build table
      expect(response.body).toContain("abc123");
    });
  });

  describe("PATCH /services/:serviceId/builds/:buildId/deploy/:env", () => {
    it("should trigger deployment and return HTML partial for HTMX swap", async () => {
      // Given: an authenticated user with a service and build
      const accountId = new ObjectId();
      const userId = new ObjectId();
      const repositoryId = new ObjectId();

      await db.collection("repositories").insertOne({
        _id: repositoryId,
        accountId,
        githubId: 12345,
        githubFullName: "my-org/my-repo",
        name: "my-repo",
        owner: "my-org",
        private: false,
        createdAt: new Date(),
      });

      const service = await serviceRepo.create({
        accountId,
        repositoryId,
        name: "deploy-service",
        environments: [
          { name: "staging", order: 0 },
          { name: "prod", order: 1 },
        ],
      });

      await buildRepo.create({
        accountId,
        serviceId: service._id,
        buildId: "build-123",
      });

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: triggering deployment
      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/builds/build-123/deploy/staging`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response is successful with HTML partial
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("deploy-service-build-123-staging");
      expect(response.body).toContain("dispatching");
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        accountId,
        service._id,
        "build-123",
        "staging",
      );
    });

    it("should return 404 when service not found", async () => {
      // Given: authenticated user but service doesn't exist
      const accountId = new ObjectId();
      const userId = new ObjectId();
      const nonExistentServiceId = new ObjectId();

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: triggering deployment for non-existent service
      const response = await app.inject({
        method: "PATCH",
        url: `/services/${nonExistentServiceId}/builds/build-123/deploy/staging`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: 404 response
      expect(response.statusCode).toBe(404);
    });

    it("should return 404 when service belongs to different account", async () => {
      // Given: a service owned by a different account
      const ownerAccountId = new ObjectId();
      const attackerAccountId = new ObjectId();
      const attackerUserId = new ObjectId();
      const repositoryId = new ObjectId();

      await db.collection("repositories").insertOne({
        _id: repositoryId,
        accountId: ownerAccountId,
        githubId: 12345,
        githubFullName: "owner-org/repo",
        name: "repo",
        owner: "owner-org",
        private: false,
        createdAt: new Date(),
      });

      const service = await serviceRepo.create({
        accountId: ownerAccountId,
        repositoryId,
        name: "protected-service",
        environments: [{ name: "staging", order: 0 }],
      });

      await buildRepo.create({
        accountId: ownerAccountId,
        serviceId: service._id,
        buildId: "protected-build",
      });

      // Attacker's session
      const sessionToken = sessionService.createSession({
        userId: attackerUserId,
        accountId: attackerAccountId,
      });

      // When: attacker tries to deploy
      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/builds/protected-build/deploy/staging`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: 404 (service not found for attacker's account)
      expect(response.statusCode).toBe(404);
      expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
    });

    it("should return 400 for invalid environment", async () => {
      // Given: a service with specific environments
      const accountId = new ObjectId();
      const userId = new ObjectId();
      const repositoryId = new ObjectId();

      await db.collection("repositories").insertOne({
        _id: repositoryId,
        accountId,
        githubId: 12345,
        githubFullName: "my-org/my-repo",
        name: "my-repo",
        owner: "my-org",
        private: false,
        createdAt: new Date(),
      });

      const service = await serviceRepo.create({
        accountId,
        repositoryId,
        name: "limited-envs",
        environments: [{ name: "staging", order: 0 }],
      });

      await buildRepo.create({
        accountId,
        serviceId: service._id,
        buildId: "build-456",
      });

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: trying to deploy to an invalid environment
      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/builds/build-456/deploy/invalid-env`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: 400 response
      expect(response.statusCode).toBe(400);
    });

    it("should redirect to home when not authenticated", async () => {
      // When: accessing deploy route without session
      const fakeServiceId = new ObjectId();
      const response = await app.inject({
        method: "PATCH",
        url: `/services/${fakeServiceId}/builds/build-123/deploy/staging`,
      });

      // Then: redirect to home
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/");
    });

    it("should return 400 for invalid service ID format", async () => {
      // Given: authenticated user
      const accountId = new ObjectId();
      const userId = new ObjectId();

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: triggering deployment with invalid serviceId
      const response = await app.inject({
        method: "PATCH",
        url: "/services/not-a-valid-objectid/builds/build-123/deploy/staging",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: 400 response
      expect(response.statusCode).toBe(400);
    });
  });
});
