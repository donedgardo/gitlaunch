import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerOnboardingRoutes } from "./index";

// Fake GitHubAppService that returns test repos
class FakeGitHubAppService {
  private repos: Array<{
    id: number;
    full_name: string;
    private: boolean;
    owner: { login: string };
    name: string;
  }> = [];

  setRepos(
    repos: Array<{
      id: number;
      full_name: string;
      private: boolean;
      owner: { login: string };
      name: string;
    }>,
  ) {
    this.repos = repos;
  }

  async listInstallationRepos(_accountId: ObjectId) {
    return this.repos;
  }

  async linkInstallation(_accountId: ObjectId, _installationId: number) {
    // no-op for tests
  }
}

describe("Onboarding Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let repositoryRepo: RepositoryRepository;
  let fakeGitHubAppService: FakeGitHubAppService;
  let sessionService: SessionService;

  const TEST_SECRET = "test-secret-for-sessions";

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});

    accountRepo = new AccountRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    fakeGitHubAppService = new FakeGitHubAppService();
    sessionService = new SessionService(TEST_SECRET);

    app = Fastify();
    await app.register(cookie);
    await app.register(formbody);
    sessionAuthMiddleware(app, sessionService);
    registerOnboardingRoutes(app, {
      accountRepository: accountRepo,
      gitHubAppService: fakeGitHubAppService as unknown as GitHubAppService,
      repositoryRepository: repositoryRepo,
    });
    await app.ready();
  });

  describe("POST /onboarding/repositories", () => {
    it("should save selected repositories to the account", async () => {
      // Given: an account with GitHub App installed
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      await accountRepo.updateInstallation(account._id, 12345);

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // And: GitHub App has repos available
      fakeGitHubAppService.setRepos([
        {
          id: 1001,
          full_name: "my-org/repo-one",
          private: false,
          owner: { login: "my-org" },
          name: "repo-one",
        },
        {
          id: 1002,
          full_name: "my-org/repo-two",
          private: false,
          owner: { login: "my-org" },
          name: "repo-two",
        },
        {
          id: 1003,
          full_name: "my-org/repo-three",
          private: true,
          owner: { login: "my-org" },
          name: "repo-three",
        },
      ]);

      // When: user selects repos and submits
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/repositories",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "repositories=1001&repositories=1002",
      });

      // Then: redirects to dashboard
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");

      // And: selected repositories are saved to the database
      const savedRepos = await repositoryRepo.findByAccountId(account._id);
      expect(savedRepos).toHaveLength(2);

      const repoNames = savedRepos.map((r) => r.githubFullName).sort();
      expect(repoNames).toEqual(["my-org/repo-one", "my-org/repo-two"]);
    });

    it("should redirect to dashboard even if no repos selected", async () => {
      // Given: an account with GitHub App installed
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-2",
      });
      await accountRepo.updateInstallation(account._id, 12345);

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: user submits without selecting any repos
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/repositories",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "",
      });

      // Then: redirects to dashboard
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");

      // And: no repositories are saved
      const savedRepos = await repositoryRepo.findByAccountId(account._id);
      expect(savedRepos).toHaveLength(0);
    });

    it("should redirect to login if not authenticated", async () => {
      // When: no session is provided
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/repositories",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "repositories=1001",
      });

      // Then: redirects to GitHub OAuth login
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/auth/github");
    });
  });
});
