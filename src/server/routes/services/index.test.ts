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
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../../registerHandlebarsHelpers";
import { registerServiceRoutes } from "./index";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { ApiKeyRepository } from "../../../repositories/apiKeyRepository";
import {
  GitHubAppService,
  IGitHubApiClient,
  GitHubRepo,
  GitHubWorkflow,
} from "../../../services/github/githubAppService";
import {
  InstallationTokenService,
  IGitHubAppClient,
  InstallationToken,
} from "../../../services/github/installationTokenService";

// Fake GitHub App client
class FakeGitHubAppClient implements IGitHubAppClient {
  async getInstallationToken(
    _installationId: number,
  ): Promise<InstallationToken> {
    return { token: "ghs_fake", expiresAt: new Date(Date.now() + 3600000) };
  }
}

// Fake GitHub API client
class FakeGitHubApiClient implements IGitHubApiClient {
  public workflowsToReturn: GitHubWorkflow[] = [
    { id: 1, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
    {
      id: 2,
      name: "Deploy",
      path: ".github/workflows/deploy.yml",
      state: "active",
    },
  ];

  async listInstallationRepos(_token: string): Promise<GitHubRepo[]> {
    return [];
  }

  async listWorkflows(
    _token: string,
    _owner: string,
    _repo: string,
  ): Promise<GitHubWorkflow[]> {
    return this.workflowsToReturn;
  }
}

describe("Service Routes - Workflow Configuration", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let serviceRepo: ServiceRepository;
  let repositoryRepo: RepositoryRepository;
  let accountRepo: AccountRepository;
  let apiKeyRepo: ApiKeyRepository;
  let sessionService: SessionService;
  let apiKeyService: ApiKeyService;
  let planEnforcementService: PlanEnforcementService;
  let githubAppService: GitHubAppService;
  let fakeApiClient: FakeGitHubApiClient;

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
    await db.collection("apiKeys").deleteMany({});
    await db.collection("accountMemberships").deleteMany({});

    serviceRepo = new ServiceRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    accountRepo = new AccountRepository(db);
    apiKeyRepo = new ApiKeyRepository(db);
    const membershipRepo = new MembershipRepository(db);
    sessionService = new SessionService(TEST_SECRET);
    apiKeyService = new ApiKeyService(apiKeyRepo, accountRepo);
    planEnforcementService = new PlanEnforcementService(
      accountRepo,
      repositoryRepo,
      serviceRepo,
      membershipRepo,
    );

    // Setup GitHub app service with fakes
    fakeApiClient = new FakeGitHubApiClient();
    const fakeAppClient = new FakeGitHubAppClient();
    const tokenService = new InstallationTokenService(fakeAppClient);
    githubAppService = new GitHubAppService(
      accountRepo,
      tokenService,
      fakeApiClient,
    );

    app = Fastify();
    await app.register(cookie, { secret: COOKIE_SECRET });
    await app.register(formbody);
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
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
    registerServiceRoutes(app, {
      cookieSecure: false,
      accountRepository: accountRepo,
      repositoryRepository: repositoryRepo,
      serviceRepository: serviceRepo,
      apiKeyService,
      githubAppService,
      planEnforcementService,
    });
    await app.ready();
  });

  describe("GET /services/:serviceId/workflows", () => {
    it("should return workflows from GitHub as HTML options", async () => {
      // Given: service linked to repo, GitHub has workflows
      const account = await accountRepo.create({
        name: "Test Org",
        slug: "test-org",
      });
      await accountRepo.updateInstallation(account._id, 12345);

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

      // When: GET /services/:id/workflows
      const response = await app.inject({
        method: "GET",
        url: `/services/${service._id}/workflows`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: HTML with workflow options returned
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("<option");
      expect(response.body).toContain("ci.yml");
      expect(response.body).toContain("deploy.yml");
    });
  });

  describe("POST /services/:serviceId/configure-workflow", () => {
    it("should update service and redirect on configure", async () => {
      // Given: a service
      const account = await accountRepo.create({
        name: "Test Org 2",
        slug: "test-org-2",
      });

      const repository = await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 888,
        githubFullName: "test-org-2/my-repo-2",
        githubRepoName: "my-repo-2",
        githubOwner: "test-org-2",
        isPrivate: false,
      });

      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "my-service-2",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: POST /services/:id/configure-workflow
      const response = await app.inject({
        method: "POST",
        url: `/services/${service._id}/configure-workflow`,
        cookies: {
          session: sessionToken,
        },
        payload: {
          workflowFile: "deploy-prod.yml",
        },
      });

      // Then: service updated, redirect to dashboard
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(`/dashboard/${service.name}`);

      // Verify service was updated
      const updatedService = await serviceRepo.findById(service._id);
      expect(updatedService?.deployment).toEqual({
        provider: "github",
        repositoryId: repository._id,
        workflowFile: "deploy-prod.yml",
      });
      expect(updatedService?.workflowConfigured).toBe(true);
    });

    it("should set workflowConfigured to true even when service was created without it", async () => {
      // Given: an existing service without workflowConfigured field (simulating old data)
      const account = await accountRepo.create({
        name: "Legacy Org",
        slug: "legacy-org",
      });

      const repository = await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 777,
        githubFullName: "legacy-org/legacy-repo",
        githubRepoName: "legacy-repo",
        githubOwner: "legacy-org",
        isPrivate: false,
      });

      // Insert directly into MongoDB without workflowConfigured field
      const serviceId = new ObjectId();
      await db.collection("services").insertOne({
        _id: serviceId,
        accountId: account._id,
        repositoryId: repository._id,
        name: "legacy-service",
        environments: [{ name: "staging", order: 0 }],
        workflowFile: "deploy.yml",
        isActive: true,
        createdAt: new Date(),
        // Note: workflowConfigured is NOT set
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: POST /services/:id/configure-workflow
      const response = await app.inject({
        method: "POST",
        url: `/services/${serviceId}/configure-workflow`,
        cookies: {
          session: sessionToken,
        },
        payload: {
          workflowFile: "deploy.yml",
        },
      });

      // Then: service updated with workflowConfigured=true
      expect(response.statusCode).toBe(302);

      const updatedService = await serviceRepo.findById(serviceId);
      expect(updatedService?.workflowConfigured).toBe(true);
    });
  });

  describe("POST /services/new — report-only creation", () => {
    async function seedAccount(slug: string) {
      const account = await accountRepo.create({ name: slug, slug });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });
      return { account, session };
    }

    it("creates a report-only service from just a name (CD picked later)", async () => {
      const { account, session } = await seedAccount("report-org");

      const response = await app.inject({
        method: "POST",
        url: "/services/new",
        cookies: { session },
        payload: { name: "api" },
      });

      // Redirects to the dashboard for the new service...
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard/api");

      const created = await serviceRepo.findByAccountIdAndName(
        account._id,
        "api",
      );
      expect(created).not.toBeNull();
      // ...with NO deployment — the CI choice must not assume a CD provider.
      expect(created?.deployment).toBeNull();

      // And a one-time API key cookie is set for the dashboard to display.
      const setCookies = response.headers["set-cookie"];
      const cookieStr = Array.isArray(setCookies)
        ? setCookies.join(";")
        : setCookies ?? "";
      expect(cookieStr).toContain("new_api_key");
    });

    it("re-renders with an error when the name is missing", async () => {
      const { account, session } = await seedAccount("noname-org");

      const response = await app.inject({
        method: "POST",
        url: "/services/new",
        cookies: { session },
        payload: { name: "" },
      });

      expect(response.statusCode).toBe(200);
      const services = await serviceRepo.findByAccountId(account._id);
      expect(services).toHaveLength(0);
    });
  });
});
