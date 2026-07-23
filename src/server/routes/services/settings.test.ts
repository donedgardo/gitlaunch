import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { SessionService } from "../../../services/auth/sessionService";
import { EnvironmentService } from "../../../services/environment/environmentService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../../registerHandlebarsHelpers";
import { registerSettingsRoutes } from "./settings";

describe("Settings Routes - Workflow Configuration", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let serviceRepo: ServiceRepository;
  let repositoryRepo: RepositoryRepository;
  let accountRepo: AccountRepository;
  let membershipRepo: MembershipRepository;
  let sessionService: SessionService;
  let environmentService: EnvironmentService;
  let planEnforcementService: PlanEnforcementService;

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
    await db.collection("repositories").deleteMany({});
    await db.collection("accounts").deleteMany({});

    serviceRepo = new ServiceRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    accountRepo = new AccountRepository(db);
    membershipRepo = new MembershipRepository(db);
    sessionService = new SessionService(TEST_SECRET);
    environmentService = new EnvironmentService(serviceRepo);
    planEnforcementService = new PlanEnforcementService(
      accountRepo,
      repositoryRepo,
      serviceRepo,
      membershipRepo,
    );

    app = Fastify();
    await app.register(cookie, { secret: COOKIE_SECRET });
    await app.register(formbody);
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: {
        partials: {
          navigation: "/partials/navigation.hbs",
          environmentList: "/partials/environmentList.hbs",
          githubSecretsSetup: "/partials/githubSecretsSetup.hbs",
          buildReportingInstructions:
            "/partials/buildReportingInstructions.hbs",
          deploymentSetupGuide: "/partials/deploymentSetupGuide.hbs",
          jenkinsBuildReportingGuide:
            "/partials/jenkinsBuildReportingGuide.hbs",
          jenkinsDeploymentGuide: "/partials/jenkinsDeploymentGuide.hbs",
          rawBuildReportingGuide: "/partials/rawBuildReportingGuide.hbs",
        },
      },
    });
    sessionAuthMiddleware(app, sessionService);
    registerSettingsRoutes(app, {
      serviceRepository: serviceRepo,
      repositoryRepository: repositoryRepo,
      environmentService,
      planEnforcementService,
    });
    await app.ready();
  });

  describe("GET /services/:serviceId/settings", () => {
    it("should render the curl-based deploy workflow snippet (no action to maintain)", async () => {
      // Given: a service belonging to the authenticated user
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });

      const repository = await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 999,
        githubFullName: "test-org/my-repo",
        githubRepoName: "my-repo",
        githubOwner: "test-org",
        isPrivate: false,
      });

      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "my-service",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: the settings page is loaded
      const response = await app.inject({
        method: "GET",
        url: `/services/${service._id}/settings`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: it renders curl-based build + deploy reporting...
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("--fail-with-body");
      expect(response.body).toContain('{"status":"deploying"}');
      expect(response.body).toContain('{"status":"deployed"}');

      // ...and no longer leans on the build-reporter action wrapper
      expect(response.body).not.toContain("donedgardo/build-reporter");
    });
  });

  describe("GET /services/:serviceId/settings — CI provider guides", () => {
    async function createServiceForProvider(
      slug: string,
      provider: "github" | "jenkins" | "raw",
    ) {
      const account = await accountRepo.create({ name: slug, slug });
      const repository = await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 999,
        githubFullName: `${slug}/my-repo`,
        githubRepoName: "my-repo",
        githubOwner: slug,
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "my-service",
      });
      if (provider === "jenkins") {
        await serviceRepo.setDeployment(account._id, service._id, {
          provider: "jenkins",
          jobName: "deploy-backend",
        });
      }
      if (provider === "raw") {
        await serviceRepo.setDeployment(account._id, service._id, {
          provider: "raw",
          endpointUrl: "https://deploy.acme.com/hook",
        });
      }
      const sessionToken = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });
      return { service, sessionToken };
    }

    it("should show Jenkins pipeline guides for a jenkins-provider service", async () => {
      // Given: a service configured to use Jenkins
      const { service, sessionToken } = await createServiceForProvider(
        "jenkins-org",
        "jenkins",
      );

      // When: the settings page is loaded
      const response = await app.inject({
        method: "GET",
        url: `/services/${service._id}/settings`,
        cookies: { session: sessionToken },
      });

      // Then: it renders the Jenkins deploy pipeline and build-report curl...
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("pipeline {");
      expect(response.body).toContain(`/api/v1/services/${service._id}/builds`);
      expect(response.body).toContain("credentials('gitlaunch-api-key')");

      // ...and not the GitHub Actions curl guide
      expect(response.body).not.toContain("--fail-with-body");
    });

    it("should show the GitHub Actions guide for a github-provider service", async () => {
      // Given: a service using the default GitHub provider
      const { service, sessionToken } = await createServiceForProvider(
        "github-org",
        "github",
      );

      // When: the settings page is loaded
      const response = await app.inject({
        method: "GET",
        url: `/services/${service._id}/settings`,
        cookies: { session: sessionToken },
      });

      // Then: it renders the GitHub Actions curl guide, not the Jenkins pipeline
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("--fail-with-body");
      expect(response.body).not.toContain("pipeline {");
    });

    it("should show the raw webhook guide for a raw-provider service", async () => {
      // Given: a service configured with a raw webhook deployment
      const { service, sessionToken } = await createServiceForProvider(
        "raw-org",
        "raw",
      );

      // When: the settings page is loaded
      const response = await app.inject({
        method: "GET",
        url: `/services/${service._id}/settings`,
        cookies: { session: sessionToken },
      });

      // Then: the raw provider is reflected and its endpoint shown...
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('value="raw"');
      expect(response.body).toContain("https://deploy.acme.com/hook");
      // ...and neither the GitHub Actions curl guide nor the Jenkins pipeline
      expect(response.body).not.toContain("--fail-with-body");
      expect(response.body).not.toContain("pipeline {");
    });
  });

  describe("PATCH /services/:serviceId/workflow", () => {
    it("should update workflow configuration and return success", async () => {
      // Given: a service with default workflow settings
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });

      const repository = await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 999,
        githubFullName: "test-org/my-repo",
        githubRepoName: "my-repo",
        githubOwner: "test-org",
        isPrivate: false,
      });

      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "my-service",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: PATCH /services/:id/workflow
      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/workflow`,
        cookies: {
          session: sessionToken,
        },
        payload: {
          workflowFile: "custom-deploy.yml",
        },
      });

      // Then: service updated, success response
      expect(response.statusCode).toBe(200);

      // Verify service was updated
      const updatedService = await serviceRepo.findById(service._id);
      expect(updatedService?.deployment).toEqual({
        provider: "github",
        repositoryId: repository._id,
        workflowFile: "custom-deploy.yml",
      });
      expect(updatedService?.workflowConfigured).toBe(true);
    });

    it("should return 401 when not authenticated", async () => {
      // Given: a service
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });

      const repository = await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 999,
        githubFullName: "test-org/my-repo",
        githubRepoName: "my-repo",
        githubOwner: "test-org",
        isPrivate: false,
      });

      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "my-service",
      });

      // When: PATCH without session
      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/workflow`,
        payload: {
          workflowFile: "custom-deploy.yml",
        },
      });

      // Then: redirect to auth
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/auth/github");
    });

    it("should return 404 when service not found", async () => {
      // Given: an account but no service
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      const fakeServiceId = new ObjectId();

      // When: PATCH non-existent service
      const response = await app.inject({
        method: "PATCH",
        url: `/services/${fakeServiceId}/workflow`,
        cookies: {
          session: sessionToken,
        },
        payload: {
          workflowFile: "custom-deploy.yml",
        },
      });

      // Then: 404
      expect(response.statusCode).toBe(404);
    });

    it("should return 404 when service belongs to another account", async () => {
      // Given: a service belonging to another account
      const otherAccount = await accountRepo.create({
        name: "Other Org",
        slug: "other-org",
      });

      const repository = await repositoryRepo.create({
        accountId: otherAccount._id,
        githubRepoId: 999,
        githubFullName: "other-org/my-repo",
        githubRepoName: "my-repo",
        githubOwner: "other-org",
        isPrivate: false,
      });

      const service = await serviceRepo.create({
        accountId: otherAccount._id,
        repositoryId: repository._id,
        name: "my-service",
      });

      // Given: a different user
      const myAccount = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: myAccount._id,
      });

      // When: PATCH service owned by other account
      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/workflow`,
        cookies: {
          session: sessionToken,
        },
        payload: {
          workflowFile: "custom-deploy.yml",
        },
      });

      // Then: 404 (don't reveal service exists)
      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /services/:serviceId", () => {
    it("should delete a service and redirect to dashboard", async () => {
      // Given: a service exists
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });

      const repository = await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "test-org/repo",
        githubRepoName: "repo",
        githubOwner: "test-org",
        isPrivate: false,
      });

      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "service-to-delete",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: DELETE the service
      const response = await app.inject({
        method: "DELETE",
        url: `/services/${service._id}`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: redirect to dashboard
      expect(response.statusCode).toBe(200);
      expect(response.headers["hx-redirect"]).toBe("/dashboard");

      // And: service is deleted
      const found = await serviceRepo.findById(service._id);
      expect(found).toBeNull();
    });

    it("should return 404 for non-existent service", async () => {
      // Given: authenticated user
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: DELETE non-existent service
      const response = await app.inject({
        method: "DELETE",
        url: `/services/${new ObjectId()}`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: 404
      expect(response.statusCode).toBe(404);
    });

    it("should return 404 when deleting another account's service", async () => {
      // Given: a service belonging to another account
      const otherAccount = await accountRepo.create({
        name: "Other Org",
        slug: "other-org",
      });

      const repository = await repositoryRepo.create({
        accountId: otherAccount._id,
        githubRepoId: 999,
        githubFullName: "other-org/repo",
        githubRepoName: "repo",
        githubOwner: "other-org",
        isPrivate: false,
      });

      const service = await serviceRepo.create({
        accountId: otherAccount._id,
        repositoryId: repository._id,
        name: "other-service",
      });

      // Given: different user
      const myAccount = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: myAccount._id,
      });

      // When: DELETE other account's service
      const response = await app.inject({
        method: "DELETE",
        url: `/services/${service._id}`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: 404 (don't reveal service exists)
      expect(response.statusCode).toBe(404);

      // And: service still exists
      const found = await serviceRepo.findById(service._id);
      expect(found).not.toBeNull();
    });
  });

  describe("PATCH /services/:serviceId/provider", () => {
    async function seedService() {
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });
      const repository = await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 999,
        githubFullName: "test-org/my-repo",
        githubRepoName: "my-repo",
        githubOwner: "test-org",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "my-service",
      });
      const sessionToken = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });
      return { service, repository, sessionToken };
    }

    it("should set the service to the jenkins provider with a job name", async () => {
      const { service, sessionToken } = await seedService();

      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/provider`,
        cookies: { session: sessionToken },
        payload: { ciProvider: "jenkins", jobName: "deploy-backend" },
      });

      expect(response.statusCode).toBe(200);
      const updated = await serviceRepo.findById(service._id);
      expect(updated?.deployment).toEqual({
        provider: "jenkins",
        jobName: "deploy-backend",
      });
    });

    it("should switch back to github with a chosen dispatch-target repo", async () => {
      const { service, repository, sessionToken } = await seedService();
      await serviceRepo.setDeployment(service.accountId, service._id, {
        provider: "jenkins",
        jobName: "deploy-backend",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/provider`,
        cookies: { session: sessionToken },
        payload: {
          ciProvider: "github",
          repositoryId: repository._id.toString(),
        },
      });

      expect(response.statusCode).toBe(200);
      const updated = await serviceRepo.findById(service._id);
      expect(updated?.deployment).toEqual({
        provider: "github",
        repositoryId: repository._id,
        workflowFile: "deploy.yml",
      });
    });

    it("should reject switching to github without a repository", async () => {
      const { service, sessionToken } = await seedService();
      await serviceRepo.setDeployment(service.accountId, service._id, {
        provider: "jenkins",
        jobName: "deploy-backend",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/provider`,
        cookies: { session: sessionToken },
        payload: { ciProvider: "github" },
      });

      // A GitHub service needs a dispatch target — the switch is rejected
      expect(response.statusCode).toBe(400);
      const updated = await serviceRepo.findById(service._id);
      expect(updated?.deployment?.provider).toBe("jenkins");
    });

    it("should reject jenkins without a job name", async () => {
      const { service, sessionToken } = await seedService();

      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/provider`,
        cookies: { session: sessionToken },
        payload: { ciProvider: "jenkins", jobName: "" },
      });

      expect(response.statusCode).toBe(400);
      const updated = await serviceRepo.findById(service._id);
      expect(updated?.deployment?.provider).toBe("github");
    });

    it("should set the service to the raw provider with an endpoint URL", async () => {
      const { service, sessionToken } = await seedService();

      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/provider`,
        cookies: { session: sessionToken },
        payload: {
          ciProvider: "raw",
          endpointUrl: "https://deploy.acme.com/hook",
        },
      });

      expect(response.statusCode).toBe(200);
      const updated = await serviceRepo.findById(service._id);
      expect(updated?.deployment).toEqual({
        provider: "raw",
        endpointUrl: "https://deploy.acme.com/hook",
      });
    });

    it("should reject raw without an endpoint URL", async () => {
      const { service, sessionToken } = await seedService();

      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/provider`,
        cookies: { session: sessionToken },
        payload: { ciProvider: "raw", endpointUrl: "" },
      });

      expect(response.statusCode).toBe(400);
      const updated = await serviceRepo.findById(service._id);
      // unchanged — still the GitHub deployment from seedService
      expect(updated?.deployment?.provider).toBe("github");
    });

    it("should reject an unknown provider", async () => {
      const { service, sessionToken } = await seedService();

      const response = await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/provider`,
        cookies: { session: sessionToken },
        payload: { ciProvider: "gitlab", jobName: "x" },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
