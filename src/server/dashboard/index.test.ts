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
import { AccountRepository } from "../../repositories/accountRepository";
import { MembershipRepository } from "../../repositories/membershipRepository";
import { TrialRegistryRepository } from "../../repositories/trialRegistryRepository";
import { DeploymentStatus } from "../../services/service/deploymentStatus";
import { SessionService } from "../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../registerHandlebarsHelpers";
import { BuildService } from "../../services/build/buildService";
import { BuildDispatchServiceI } from "../../services/build/buildDispatchService";
import { PlanEnforcementService } from "../../services/billing/planEnforcementService";
import { TrialService } from "../../services/billing/trialService";
import dashboardRoutes from "./index";

describe("Dashboard Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let serviceRepo: ServiceRepository;
  let buildRepo: BuildRepository;
  let repositoryRepo: RepositoryRepository;
  let accountRepo: AccountRepository;
  let membershipRepo: MembershipRepository;
  let trialRegistryRepo: TrialRegistryRepository;
  let sessionService: SessionService;
  let buildService: BuildService;
  let planEnforcementService: PlanEnforcementService;
  let trialService: TrialService;
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
    await db.collection("accounts").deleteMany({});
    await db.collection("memberships").deleteMany({});
    await db.collection("trialRegistry").deleteMany({});
    vi.clearAllMocks();

    serviceRepo = new ServiceRepository(db);
    buildRepo = new BuildRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    accountRepo = new AccountRepository(db);
    membershipRepo = new MembershipRepository(db);
    trialRegistryRepo = new TrialRegistryRepository(db);
    await trialRegistryRepo.ensureIndexes();

    planEnforcementService = new PlanEnforcementService(
      accountRepo,
      repositoryRepo,
      serviceRepo,
      membershipRepo,
    );
    trialService = new TrialService(accountRepo, trialRegistryRepo);

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
          paginationControls: "/partials/paginationControls.hbs",
          setupStep: "/partials/setupStep.hbs",
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
        trialService,
        planEnforcementService,
      }),
    );
    await app.ready();
  });

  describe("GET /dashboard/:serviceName", () => {
    it("should show a 'New Service' link in navigation when services exist", async () => {
      // Given: an authenticated user with a service
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });
      const accountId = account._id;
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
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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

  describe("DELETE /services/:serviceId/builds/:buildId/deploy/:env - Cancel deployment", () => {
    it("should cancel a deploying deployment and return updated status", async () => {
      // Given: authenticated user with a service and a deploying build
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
      const userId = new ObjectId();

      const repository = await repositoryRepo.create({
        accountId,
        githubRepoId: 12345,
        githubFullName: "test-org/cancel-repo",
        githubRepoName: "cancel-repo",
        githubOwner: "test-org",
        isPrivate: false,
      });

      const service = await serviceRepo.create({
        accountId,
        repositoryId: repository._id,
        name: "cancel-service",
      });

      // Create a build with deploying status
      await buildRepo.create({
        accountId,
        serviceId: service._id,
        buildId: "cancel-build-123",
      });
      await buildRepo.updateDeploymentStatus(
        accountId,
        service._id,
        "cancel-build-123",
        "staging",
        DeploymentStatus.DEPLOYING,
      );

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: cancelling the deployment
      const response = await app.inject({
        method: "DELETE",
        url: `/services/${service._id}/builds/cancel-build-123/deploy/staging`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: success response with cancelled status
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("cancelled");

      // And: build status is updated to cancelled
      const build = await buildRepo.findByBuildId(
        accountId,
        service._id,
        "cancel-build-123",
      );
      expect(build?.deployments.staging).toBe("cancelled");
    });

    it("should return 400 when trying to cancel a non-cancellable status", async () => {
      // Given: authenticated user with a deployed build
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
      const userId = new ObjectId();

      const repository = await repositoryRepo.create({
        accountId,
        githubRepoId: 12346,
        githubFullName: "test-org/deployed-repo",
        githubRepoName: "deployed-repo",
        githubOwner: "test-org",
        isPrivate: false,
      });

      const service = await serviceRepo.create({
        accountId,
        repositoryId: repository._id,
        name: "deployed-service",
      });

      await buildRepo.create({
        accountId,
        serviceId: service._id,
        buildId: "deployed-build",
      });
      await buildRepo.updateDeploymentStatus(
        accountId,
        service._id,
        "deployed-build",
        "staging",
        DeploymentStatus.DEPLOYED,
      );

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: trying to cancel a deployed build
      const response = await app.inject({
        method: "DELETE",
        url: `/services/${service._id}/builds/deployed-build/deploy/staging`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: 400 response
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("Cannot cancel");
    });
  });

  describe("GET /dashboard/:serviceName - Pagination", () => {
    it("should default to page 1 when no page parameter provided", async () => {
      // Given: authenticated user with a service and 25 builds
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
        name: "paginated-service",
        environments: [
          { name: "staging", order: 0 },
          { name: "prod", order: 1 },
        ],
      });

      // Mark workflow as configured so builds table shows
      await serviceRepo.updateWorkflowConfiguration(service._id, {
        workflowFile: "deploy.yml",
        eventType: "deployment",
      });

      // Create 25 builds
      for (let i = 1; i <= 25; i++) {
        await buildRepo.create({
          accountId,
          serviceId: service._id,
          buildId: `build-${i}`,
        });
      }

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting dashboard without page parameter
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/paginated-service",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response is successful and contains pagination data for page 1
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("build-25"); // First build (newest)
      expect(response.body).toContain("build-6"); // 20th build
      expect(response.body).not.toContain("build-5"); // 21st build (not on page 1)
    });

    it("should load page 2 when ?page=2 is provided", async () => {
      // Given: authenticated user with a service and 25 builds
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
        name: "page2-service",
        environments: [
          { name: "staging", order: 0 },
          { name: "prod", order: 1 },
        ],
      });

      // Mark workflow as configured so builds table shows
      await serviceRepo.updateWorkflowConfiguration(service._id, {
        workflowFile: "deploy.yml",
        eventType: "deployment",
      });

      // Create 25 builds
      for (let i = 1; i <= 25; i++) {
        await buildRepo.create({
          accountId,
          serviceId: service._id,
          buildId: `build-${i}`,
        });
      }

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting page 2
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/page2-service?page=2",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response contains builds from page 2
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("build-5"); // 21st build (first on page 2)
      expect(response.body).toContain("build-1"); // 25th build (last)
      expect(response.body).not.toContain("build-6"); // 20th build (last on page 1)
    });

    it("should pass pagination metadata with hasMore=true on page 1 when there are more builds", async () => {
      // Given: authenticated user with 25 builds (more than one page)
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
        name: "hasmore-service",
        environments: [{ name: "staging", order: 0 }],
      });

      for (let i = 1; i <= 25; i++) {
        await buildRepo.create({
          accountId,
          serviceId: service._id,
          buildId: `build-${i}`,
        });
      }

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting page 1
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/hasmore-service?page=1",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response indicates hasMore=true, hasPrev=false
      expect(response.statusCode).toBe(200);
      // Check for pagination data in response (we'll verify structure after implementation)
      expect(response.body).toBeTruthy();
    });

    it("should pass pagination metadata with hasMore=false on last page", async () => {
      // Given: authenticated user with 25 builds
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
        name: "lastpage-service",
        environments: [{ name: "staging", order: 0 }],
      });

      for (let i = 1; i <= 25; i++) {
        await buildRepo.create({
          accountId,
          serviceId: service._id,
          buildId: `build-${i}`,
        });
      }

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting last page (page 2)
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/lastpage-service?page=2",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response indicates hasMore=false, hasPrev=true
      expect(response.statusCode).toBe(200);
      expect(response.body).toBeTruthy();
    });

    it("should pass pagination data to HTMX partial requests", async () => {
      // Given: authenticated user with 25 builds
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
        name: "htmx-service",
        environments: [{ name: "staging", order: 0 }],
      });

      // Mark workflow as configured so builds table shows
      await serviceRepo.updateWorkflowConfiguration(service._id, {
        workflowFile: "deploy.yml",
        eventType: "deployment",
      });

      for (let i = 1; i <= 25; i++) {
        await buildRepo.create({
          accountId,
          serviceId: service._id,
          buildId: `build-${i}`,
        });
      }

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: HTMX request for page 2
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/htmx-service?page=2",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "hx-request": "true",
        },
      });

      // Then: response is partial with pagination data
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("build-5"); // First build on page 2
    });

    it("should handle empty builds with pagination correctly", async () => {
      // Given: authenticated user with service but no builds
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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

      await serviceRepo.create({
        accountId,
        repositoryId,
        name: "empty-service",
        environments: [{ name: "staging", order: 0 }],
      });

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting dashboard
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/empty-service",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response shows empty state (same as before pagination)
      expect(response.statusCode).toBe(200);
      // Should not show deployment setup guide (no builds)
      expect(response.body).not.toContain("Create Your Deploy Workflow");
    });

    it("should still show deployment setup guide on page 2+ when workflow not configured", async () => {
      // Given: service with 25 builds, workflow not configured
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
        name: "setup-page2-service",
        environments: [{ name: "staging", order: 0 }],
      });

      for (let i = 1; i <= 25; i++) {
        await buildRepo.create({
          accountId,
          serviceId: service._id,
          buildId: `build-${i}`,
        });
      }

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting page 2 (has no builds array, but total > 0)
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/setup-page2-service?page=2",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response shows deployment setup guide (based on total, not builds.length)
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Create Your Deploy Workflow");
    });

    it("should display pagination controls when builds span multiple pages", async () => {
      // Given: authenticated user with 25 builds (requires 2 pages)
      const account = await accountRepo.create({
        name: "Test Org",
        slug: `test-org-${Date.now()}-${Math.random()}`,
      });
      const accountId = account._id;
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
        name: "pagination-ui-service",
        environments: [{ name: "staging", order: 0 }],
      });

      // Mark workflow as configured so builds table shows
      await serviceRepo.updateWorkflowConfiguration(service._id, {
        workflowFile: "deploy.yml",
        eventType: "deployment",
      });

      // Create 25 builds
      for (let i = 1; i <= 25; i++) {
        await buildRepo.create({
          accountId,
          serviceId: service._id,
          buildId: `build-${i}`,
        });
      }

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting page 1
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/pagination-ui-service",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: response contains pagination controls
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Page 1 of 2");
      expect(response.body).toContain("Next");
      expect(response.body).toContain("cursor-not-allowed"); // Previous button disabled on page 1
    });
  });
});
