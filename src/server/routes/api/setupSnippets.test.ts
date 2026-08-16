import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import { parse } from "yaml";
import { AccountRepository } from "../../../repositories/accountRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { registerSetupSnippetsRoutes } from "./setupSnippets";
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

describe("Setup Snippets API", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let serviceRepo: ServiceRepository;
  let repositoryRepo: RepositoryRepository;

  let testAccountId: ObjectId;
  let testServiceId: ObjectId;
  let currentAuthContext: { accountId: ObjectId; scopes: ApiKeyScope[] } | null;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    serviceRepo = new ServiceRepository(db);
    repositoryRepo = new RepositoryRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("services").deleteMany({});
    await db.collection("repositories").deleteMany({});

    app = Fastify();
    app.addHook(
      "preHandler",
      createMockApiKeyAuth(() => currentAuthContext),
    );
    registerSetupSnippetsRoutes(app, {
      serviceRepository: serviceRepo,
      repositoryRepository: repositoryRepo,
      apiUrl: "https://gitlaunch.dev",
    });
    await app.ready();

    const account = await accountRepo.create({
      name: "Test Org",
      slug: "test-org",
    });
    testAccountId = account._id;

    const service = await serviceRepo.create({
      accountId: testAccountId,
      name: "backend",
    });
    testServiceId = service._id;

    currentAuthContext = {
      accountId: testAccountId,
      scopes: ["services:read"],
    };
  });

  describe("GET /api/v1/services/:serviceId/setup-snippets", () => {
    it("should return a deploy workflow wired to this service", async () => {
      // When an agent asks for the setup snippets
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/setup-snippets`,
      });

      // Then it gets a deploy workflow and the path to save it at
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.deploy.githubPath).toBe(".github/workflows/deploy.yml");

      const workflow = parse(body.deploy.github);
      expect(Object.keys(workflow.on.workflow_dispatch.inputs).sort()).toEqual([
        "buildId",
        "environment",
      ]);
    });

    it("should offer the service's own environments", async () => {
      // Given a service with custom environments
      await serviceRepo.addEnvironment(testServiceId, {
        name: "canary",
        order: 2,
      });

      // When an agent asks for the setup snippets
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/setup-snippets`,
      });

      // Then the deploy workflow offers that environment too
      const workflow = parse(response.json().deploy.github);
      expect(
        workflow.on.workflow_dispatch.inputs.environment.options,
      ).toContain("canary");
    });

    it("should name the secret and variable the workflow expects", async () => {
      // When an agent asks for the setup snippets
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/setup-snippets`,
      });

      // Then it learns what to tell the user to configure in their repo
      const body = response.json();
      expect(body.secrets.secretName).toBe("GITLAUNCH_API_KEY");
      expect(body.secrets.variableName).toBe("GITLAUNCH_SERVICE_ID");
      expect(body.secrets.serviceId).toBe(testServiceId.toString());
    });

    it("should include build reporting snippets for each provider", async () => {
      // When an agent asks for the setup snippets
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/setup-snippets`,
      });

      // Then it can wire up whichever CI the repo actually uses
      const body = response.json();
      expect(body.buildReport.github).toContain("curl");
      expect(body.buildReport.jenkins).toContain("curl");
      expect(body.buildReport.raw).toContain("curl");
    });

    it("should gate the build report on the repo's default branch", async () => {
      // Given the service deploys a repository whose default branch is master
      const repository = await repositoryRepo.create({
        accountId: testAccountId,
        githubRepoId: 4242,
        githubFullName: "acme/legacy",
        githubOwner: "acme",
        githubRepoName: "legacy",
        isPrivate: false,
        defaultBranch: "master",
      });
      await serviceRepo.setDeployment(testAccountId, testServiceId, {
        provider: "github",
        repositoryId: repository._id,
        workflowFile: "deploy.yml",
      });

      // When an agent asks for the setup snippets
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/setup-snippets`,
      });

      // Then the report step is guarded on master, not main — guarded on a
      // branch the repo does not have, it would never run and the dashboard
      // would stay empty with nothing to show why
      expect(response.json().buildReport.github).toContain(
        "github.ref == 'refs/heads/master'",
      );
    });

    it("should gate on main when the service has no repository bound yet", async () => {
      // Given a service created during onboarding, before CD is configured

      // When an agent asks for the setup snippets
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/setup-snippets`,
      });

      // Then the guard falls back to main
      expect(response.json().buildReport.github).toContain(
        "github.ref == 'refs/heads/main'",
      );
    });

    it("should not expose another account's service", async () => {
      // Given a service belonging to somebody else
      const otherAccount = await accountRepo.create({
        name: "Other Org",
        slug: "other-org",
      });
      const otherService = await serviceRepo.create({
        accountId: otherAccount._id,
        name: "their-api",
      });

      // When this account's key asks for its snippets
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${otherService._id}/setup-snippets`,
      });

      // Then it is not found
      expect(response.statusCode).toBe(404);
    });

    it("should reject a malformed service id", async () => {
      // When the service id is not an ObjectId
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/services/not-an-id/setup-snippets",
      });

      // Then it is a bad request rather than a crash
      expect(response.statusCode).toBe(400);
    });

    it("should require a key that can read services", async () => {
      // Given a key that may only report builds
      currentAuthContext = {
        accountId: testAccountId,
        scopes: ["builds:write"],
      };

      // When it asks for the setup snippets
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/services/${testServiceId}/setup-snippets`,
      });

      // Then it is refused
      expect(response.statusCode).toBe(403);
    });
  });
});
