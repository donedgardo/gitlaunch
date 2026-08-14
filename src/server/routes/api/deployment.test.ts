import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { GitHubRepo } from "../../../services/github/githubAppService";
import { registerDeploymentRoutes } from "./deployment";
import { ApiKeyScope } from "../../../repositories/apiKeyRepository";

function createMockApiKeyAuth(
  getContext: () => { accountId: ObjectId; scopes: ApiKeyScope[] } | null,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const context = getContext();
    if (!context) {
      return reply.status(401).send({ error: "API key required" });
    }
    request.apiKey = {
      accountId: context.accountId,
      apiKeyId: new ObjectId(),
      scopes: context.scopes,
      kind: "secret",
      allowedOrigins: [],
    };
  };
}

const repo = (id: number, fullName: string, isPrivate = false): GitHubRepo => ({
  id,
  name: fullName.split("/")[1],
  full_name: fullName,
  private: isPrivate,
  owner: { login: fullName.split("/")[0] },
});

describe("Deployment configuration API", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let repositoryRepo: RepositoryRepository;
  let serviceRepo: ServiceRepository;
  let membershipRepo: MembershipRepository;
  let planEnforcementService: PlanEnforcementService;

  let testAccountId: ObjectId;
  let testServiceId: ObjectId;
  let currentAuthContext: { accountId: ObjectId; scopes: ApiKeyScope[] } | null;
  let installationRepos: GitHubRepo[];

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    serviceRepo = new ServiceRepository(db);
    membershipRepo = new MembershipRepository(db);
    planEnforcementService = new PlanEnforcementService(
      accountRepo,
      repositoryRepo,
      serviceRepo,
      membershipRepo,
    );
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});
    await db.collection("services").deleteMany({});

    installationRepos = [repo(1, "acme/api"), repo(2, "acme/secret", true)];

    app = Fastify();
    app.addHook(
      "preHandler",
      createMockApiKeyAuth(() => currentAuthContext),
    );
    registerDeploymentRoutes(app, {
      serviceRepository: serviceRepo,
      repositoryRepository: repositoryRepo,
      accountRepository: accountRepo,
      planEnforcementService,
      gitHubAppService: {
        listInstallationRepos: async () => installationRepos,
      },
    });
    await app.ready();

    const account = await accountRepo.create({
      name: "Acme",
      slug: "acme",
    });
    testAccountId = account._id;
    await accountRepo.updateInstallation(testAccountId, 42);

    const service = await serviceRepo.create({
      accountId: testAccountId,
      name: "api",
    });
    testServiceId = service._id;

    currentAuthContext = {
      accountId: testAccountId,
      scopes: ["services:write"],
    };
  });

  const configure = (body: unknown, serviceId: ObjectId = testServiceId) =>
    app.inject({
      method: "POST",
      url: `/api/v1/services/${serviceId}/deployment`,
      payload: body as object,
    });

  describe("GitHub Actions", () => {
    it("should make a service deployable from an owner/repo name", async () => {
      // Given a repo the installation can see
      // When an agent configures the deployment by name
      const response = await configure({
        provider: "github",
        repository: "acme/api",
        workflowFile: "deploy.yml",
      });

      // Then the service is deployable
      expect(response.statusCode).toBe(200);
      const service = await serviceRepo.findById(testServiceId);
      expect(service?.deployment).toMatchObject({
        provider: "github",
        workflowFile: "deploy.yml",
      });
      expect(service?.workflowConfigured).toBe(true);
    });

    it("should register a repository the account had not saved yet", async () => {
      // Given the account has selected no repositories
      expect(await repositoryRepo.findByAccountId(testAccountId)).toHaveLength(
        0,
      );

      // When an agent configures a deployment for one it can see
      await configure({ provider: "github", repository: "acme/api" });

      // Then the repository is registered, so no browser trip is needed
      const saved = await repositoryRepo.findByAccountId(testAccountId);
      expect(saved.map((r) => r.githubFullName)).toEqual(["acme/api"]);
    });

    it("should reuse a repository that is already registered", async () => {
      // Given the repository was already saved
      await repositoryRepo.create({
        accountId: testAccountId,
        githubRepoId: 1,
        githubFullName: "acme/api",
        githubOwner: "acme",
        githubRepoName: "api",
        isPrivate: false,
      });

      // When an agent configures the deployment
      await configure({ provider: "github", repository: "acme/api" });

      // Then it is not duplicated
      expect(await repositoryRepo.findByAccountId(testAccountId)).toHaveLength(
        1,
      );
    });

    it("should default the workflow file to deploy.yml", async () => {
      // When no workflow file is given
      await configure({ provider: "github", repository: "acme/api" });

      // Then it matches the file the setup snippets tell agents to write
      const service = await serviceRepo.findById(testServiceId);
      expect(service?.deployment).toMatchObject({ workflowFile: "deploy.yml" });
    });

    it("should reject a workflow file that is not a bare yml filename", async () => {
      // When the workflow file tries to escape the workflows directory
      const response = await configure({
        provider: "github",
        repository: "acme/api",
        workflowFile: "../../../etc/passwd",
      });

      // Then it is refused — this value is interpolated into a GitHub API path
      expect(response.statusCode).toBe(400);
      const service = await serviceRepo.findById(testServiceId);
      expect(service?.deployment).toBeNull();
    });

    it("should not configure a repo the installation cannot see", async () => {
      // When the named repo is not in the installation
      const response = await configure({
        provider: "github",
        repository: "someone-else/private",
      });

      // Then it is not found, and nothing is registered
      expect(response.statusCode).toBe(404);
      expect(await repositoryRepo.findByAccountId(testAccountId)).toHaveLength(
        0,
      );
    });

    it("should tell the user to install the GitHub App when it is missing", async () => {
      // Given an account with no GitHub App installed
      await accountRepo.clearGithubConnection(testAccountId);

      // When an agent tries to configure a GitHub deployment
      const response = await configure({
        provider: "github",
        repository: "acme/api",
      });

      // Then it is told what to do — this is the one step a browser must do
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatch(/install/i);
    });

    it("should refuse a private repo on a plan that does not allow one", async () => {
      // Given the Free plan, which is public-repos-only
      // When an agent configures a private repository
      const response = await configure({
        provider: "github",
        repository: "acme/secret",
      });

      // Then it is refused rather than silently registered
      expect(response.statusCode).toBe(403);
      expect(await repositoryRepo.findByAccountId(testAccountId)).toHaveLength(
        0,
      );
    });

    it("should enforce the plan's repository limit", async () => {
      // Given the account is already at its repository limit
      const usage = await planEnforcementService.getUsage(testAccountId);
      for (let i = 0; i < usage.repositories.limit; i++) {
        await repositoryRepo.create({
          accountId: testAccountId,
          githubRepoId: 900 + i,
          githubFullName: `acme/filler-${i}`,
          githubOwner: "acme",
          githubRepoName: `filler-${i}`,
          isPrivate: false,
        });
      }

      // When an agent configures one more
      const response = await configure({
        provider: "github",
        repository: "acme/api",
      });

      // Then it is refused with an upgrade hint
      expect(response.statusCode).toBe(403);
      expect(response.json().upgradeRequired).toBe(true);
    });
  });

  describe("Jenkins", () => {
    it("should make a service deployable from a job name", async () => {
      // Given an account with a Jenkins server connected
      await db
        .collection("accounts")
        .updateOne(
          { _id: testAccountId },
          { $set: { jenkinsConnection: { baseUrl: "https://ci.acme.com" } } },
        );

      // When an agent configures the deployment
      const response = await configure({
        provider: "jenkins",
        jobName: "deploy-api",
      });

      // Then the service is deployable
      expect(response.statusCode).toBe(200);
      const service = await serviceRepo.findById(testServiceId);
      expect(service?.deployment).toMatchObject({
        provider: "jenkins",
        jobName: "deploy-api",
      });
    });

    it("should require a Jenkins server to be connected first", async () => {
      // When no Jenkins connection exists
      const response = await configure({
        provider: "jenkins",
        jobName: "deploy-api",
      });

      // Then it is refused with an explanation
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatch(/jenkins/i);
    });
  });

  describe("Raw webhook", () => {
    it("should make a service deployable from an endpoint URL", async () => {
      // When an agent configures a raw endpoint
      const response = await configure({
        provider: "raw",
        endpointUrl: "https://deploy.acme.com/hook",
      });

      // Then the service is deployable without any GitHub App
      expect(response.statusCode).toBe(200);
      const service = await serviceRepo.findById(testServiceId);
      expect(service?.deployment).toMatchObject({
        provider: "raw",
        endpointUrl: "https://deploy.acme.com/hook",
      });
    });

    it("should reject an endpoint that is not an http URL", async () => {
      // When the endpoint is not something GitLaunch can POST to
      const response = await configure({
        provider: "raw",
        endpointUrl: "file:///etc/passwd",
      });

      // Then it is refused
      expect(response.statusCode).toBe(400);
    });
  });

  describe("access control", () => {
    it("should not configure another account's service", async () => {
      // Given a service belonging to somebody else
      const other = await accountRepo.create({ name: "Other", slug: "other" });
      const otherService = await serviceRepo.create({
        accountId: other._id,
        name: "theirs",
      });

      // When this account's key tries to configure it
      const response = await configure(
        { provider: "raw", endpointUrl: "https://evil.example/hook" },
        otherService._id,
      );

      // Then it is not found, and theirs is untouched
      expect(response.statusCode).toBe(404);
      expect((await serviceRepo.findById(otherService._id))?.deployment).toBe(
        null,
      );
    });

    it("should require a key that can write services", async () => {
      // Given a key that may only report builds
      currentAuthContext = {
        accountId: testAccountId,
        scopes: ["builds:write"],
      };

      // When it tries to configure a deployment
      const response = await configure({
        provider: "raw",
        endpointUrl: "https://deploy.acme.com/hook",
      });

      // Then it is refused
      expect(response.statusCode).toBe(403);
    });

    it("should reject an unknown provider", async () => {
      // When the provider is not one GitLaunch can dispatch to
      const response = await configure({
        provider: "buildkite",
        jobName: "deploy",
      });

      // Then it is a bad request
      expect(response.statusCode).toBe(400);
    });
  });
});
