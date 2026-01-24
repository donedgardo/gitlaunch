import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { BuildRepository } from "../../repositories/buildRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { SessionService } from "../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../registerHandlebarsHelpers";
import dashboardRoutes from "./index";
import { DeploymentStatus } from "../../services/service/deploymentStatus";

describe("Dashboard Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let serviceRepo: ServiceRepository;
  let buildRepo: BuildRepository;
  let repositoryRepo: RepositoryRepository;
  let sessionService: SessionService;

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

    serviceRepo = new ServiceRepository(db);
    buildRepo = new BuildRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    sessionService = new SessionService(TEST_SECRET);

    app = Fastify();
    await app.register(cookie, { secret: COOKIE_SECRET });
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../templates"),
      options: {
        partials: {
          buildEnvironmentAction: "/partials/buildEnvironmentAction.hbs",
          navigation: "/partials/navigation.hbs",
          buildRow: "/partials/buildRow.hbs",
          buildTable: "/partials/buildTable.hbs",
          emptyBuilds: "/partials/emptyBuilds.hbs",
          deploymentSetupGuide: "/partials/deploymentSetupGuide.hbs",
        },
      },
    });
    sessionAuthMiddleware(app, sessionService);
    app.register(
      dashboardRoutes({
        serviceRepository: serviceRepo,
        buildRepository: buildRepo,
        repositoryRepository: repositoryRepo,
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
          { name: "staging", displayName: "Staging", order: 0 },
          { name: "prod", displayName: "Production", order: 1 },
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

    it("should show deployment setup guide when builds exist but no deployments", async () => {
      // Given: service with builds, no deployments
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
        name: "needs-setup-service",
        environments: [
          { name: "staging", displayName: "Staging", order: 0 },
          { name: "prod", displayName: "Production", order: 1 },
        ],
      });

      // Create a build with no deployments
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

      // Then: response contains "Configure Deployment Workflow"
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Configure Deployment Workflow");
    });

    it("should not show deployment setup guide when deployments exist", async () => {
      // Given: service with builds that have deployments
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
        name: "has-deployments",
        environments: [
          { name: "staging", displayName: "Staging", order: 0 },
          { name: "prod", displayName: "Production", order: 1 },
        ],
      });

      // Create a build and add a deployment
      await buildRepo.create({
        accountId,
        serviceId: service._id,
        buildId: "abc123",
      });
      await buildRepo.updateDeploymentStatus(
        accountId,
        service._id,
        "abc123",
        "staging",
        DeploymentStatus.DEPLOYED,
      );

      const sessionToken = sessionService.createSession({
        userId,
        accountId,
      });

      // When: visiting dashboard
      const response = await app.inject({
        method: "GET",
        url: "/dashboard/has-deployments",
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
});
