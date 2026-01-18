import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie, { sign } from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { ApiKeyRepository } from "../../../repositories/apiKeyRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
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
  let membershipRepo: MembershipRepository;
  let apiKeyRepo: ApiKeyRepository;
  let apiKeyService: ApiKeyService;
  let planEnforcementService: PlanEnforcementService;
  let fakeGitHubAppService: FakeGitHubAppService;
  let sessionService: SessionService;

  const TEST_SECRET = "test-secret-for-sessions";
  const COOKIE_SECRET = "test-cookie-secret";

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
    await db.collection("memberships").deleteMany({});
    await db.collection("apiKeys").deleteMany({});

    accountRepo = new AccountRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    membershipRepo = new MembershipRepository(db);
    apiKeyRepo = new ApiKeyRepository(db);
    apiKeyService = new ApiKeyService(apiKeyRepo, accountRepo);
    planEnforcementService = new PlanEnforcementService(
      accountRepo,
      repositoryRepo,
      membershipRepo,
    );
    fakeGitHubAppService = new FakeGitHubAppService();
    sessionService = new SessionService(TEST_SECRET);

    app = Fastify();
    await app.register(cookie, { secret: COOKIE_SECRET });
    await app.register(formbody);
    sessionAuthMiddleware(app, sessionService);
    registerOnboardingRoutes(app, {
      accountRepository: accountRepo,
      gitHubAppService: fakeGitHubAppService as unknown as GitHubAppService,
      repositoryRepository: repositoryRepo,
      apiKeyService,
      planEnforcementService,
    });
    await app.ready();
  });

  describe("POST /onboarding/repositories", () => {
    it("should save selected repositories to the account", async () => {
      // Given: an account with GitHub App installed (paid plan to allow multiple repos)
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      await accountRepo.updateInstallation(account._id, 12345);
      await accountRepo.upgradeToPaid(account._id, "cus_test", "sub_test");

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

      // Then: redirects to onboarding complete page (key in cookie, not URL)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding/complete");

      // And: selected repositories are saved to the database
      const savedRepos = await repositoryRepo.findByAccountId(account._id);
      expect(savedRepos).toHaveLength(2);

      const repoNames = savedRepos.map((r) => r.githubFullName).sort();
      expect(repoNames).toEqual(["my-org/repo-one", "my-org/repo-two"]);
    });

    it("should generate an API key on onboarding completion", async () => {
      // Given: an account with GitHub App installed
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-apikey",
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
      ]);

      // When: user completes onboarding
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/repositories",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "repositories=1001",
      });

      // Then: redirects to onboarding complete page (key in cookie, not URL)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding/complete");

      // And: a signed cookie is set with the API key
      const cookies = response.cookies;
      const apiKeyCookie = cookies.find(
        (c: { name: string }) => c.name === "onboarding_api_key",
      );
      expect(apiKeyCookie).toBeDefined();

      // And: an API key is created in the database
      const apiKeys = await apiKeyRepo.findByAccountId(account._id);
      expect(apiKeys).toHaveLength(1);
      expect(apiKeys[0].name).toBe("Default API Key");
      expect(apiKeys[0].scopes).toContain("builds:read");
      expect(apiKeys[0].scopes).toContain("builds:write");
      expect(apiKeys[0].scopes).toContain("deployments:write");
    });

    it("should redirect to onboarding complete even if no repos selected", async () => {
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

      // Then: redirects to onboarding complete page (key in cookie, not URL)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding/complete");

      // And: no repositories are saved
      const savedRepos = await repositoryRepo.findByAccountId(account._id);
      expect(savedRepos).toHaveLength(0);

      // And: an API key is still created
      const apiKeys = await apiKeyRepo.findByAccountId(account._id);
      expect(apiKeys).toHaveLength(1);
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

  describe("GET /onboarding/complete", () => {
    it("should display the API key from signed cookie", async () => {
      // Given: an authenticated user
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-complete",
      });
      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      const testApiKey = "pk_my-org-complete_abc123xyz";

      // Create a signed cookie value
      const signedCookie = sign(testApiKey, COOKIE_SECRET);

      // When: visiting the complete page with signed cookie
      const response = await app.inject({
        method: "GET",
        url: "/onboarding/complete",
        cookies: {
          session: sessionToken,
          onboarding_api_key: signedCookie,
        },
      });

      // Then: returns 200 with API key visible
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(testApiKey);
      expect(response.body).toContain("Your API Key");

      // And: cookie is cleared (one-time display)
      const clearCookie = response.cookies.find(
        (c: { name: string }) => c.name === "onboarding_api_key",
      );
      expect(clearCookie).toBeDefined();
      expect(clearCookie?.value).toBe("");
    });

    it("should redirect to login if not authenticated", async () => {
      // When: no session is provided
      const signedCookie = sign("pk_test_abc123", COOKIE_SECRET);
      const response = await app.inject({
        method: "GET",
        url: "/onboarding/complete",
        cookies: {
          onboarding_api_key: signedCookie,
        },
      });

      // Then: redirects to GitHub OAuth login
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/auth/github");
    });

    it("should redirect to dashboard if no cookie provided", async () => {
      // Given: an authenticated user
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-nokey",
      });
      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: visiting complete page without cookie (already viewed)
      const response = await app.inject({
        method: "GET",
        url: "/onboarding/complete",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: redirects to dashboard
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");
    });

    it("should reject tampered cookie and redirect to dashboard", async () => {
      // Given: an authenticated user
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-tampered",
      });
      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // And: a tampered (unsigned) cookie value
      const tamperedCookie = "pk_stolen_key_attempt";

      // When: visiting complete page with tampered cookie
      const response = await app.inject({
        method: "GET",
        url: "/onboarding/complete",
        cookies: {
          session: sessionToken,
          onboarding_api_key: tamperedCookie,
        },
      });

      // Then: redirects to dashboard (cookie rejected)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");
    });

    it("should reject cookie signed with wrong secret", async () => {
      // Given: an authenticated user
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-wrongsecret",
      });
      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // And: a cookie signed with a different secret
      const wrongSecretCookie = sign("pk_test_key", "wrong-secret");

      // When: visiting complete page with wrongly signed cookie
      const response = await app.inject({
        method: "GET",
        url: "/onboarding/complete",
        cookies: {
          session: sessionToken,
          onboarding_api_key: wrongSecretCookie,
        },
      });

      // Then: redirects to dashboard (signature mismatch)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");
    });
  });

  describe("Plan Enforcement", () => {
    it("should reject selecting more repos than free plan allows", async () => {
      // Given: an account on free plan (maxRepositories: 1)
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org",
      });
      await accountRepo.updateInstallation(account._id, 12345);

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // And: GitHub App has multiple repos available
      fakeGitHubAppService.setRepos([
        {
          id: 1001,
          full_name: "free-org/repo-one",
          private: false,
          owner: { login: "free-org" },
          name: "repo-one",
        },
        {
          id: 1002,
          full_name: "free-org/repo-two",
          private: false,
          owner: { login: "free-org" },
          name: "repo-two",
        },
      ]);

      // When: user tries to select 2 repos (exceeds free plan limit of 1)
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

      // Then: returns 400 with error message
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain("free plan allows up to 1 repository");

      // And: no repositories are saved
      const savedRepos = await repositoryRepo.findByAccountId(account._id);
      expect(savedRepos).toHaveLength(0);
    });

    it("should reject private repos on free plan", async () => {
      // Given: an account on free plan (publicReposOnly: true)
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org-private",
      });
      await accountRepo.updateInstallation(account._id, 12345);

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // And: GitHub App has a private repo
      fakeGitHubAppService.setRepos([
        {
          id: 1001,
          full_name: "free-org/private-repo",
          private: true,
          owner: { login: "free-org" },
          name: "private-repo",
        },
      ]);

      // When: user tries to select a private repo
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/repositories",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "repositories=1001",
      });

      // Then: returns 400 with error message
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain("Private repositories require a paid plan");

      // And: no repositories are saved
      const savedRepos = await repositoryRepo.findByAccountId(account._id);
      expect(savedRepos).toHaveLength(0);
    });

    it("should allow paid plan to select multiple repos", async () => {
      // Given: an account on paid plan
      const account = await accountRepo.create({
        name: "Paid Org",
        slug: "paid-org",
      });
      await accountRepo.updateInstallation(account._id, 12345);
      await accountRepo.upgradeToPaid(account._id, "cus_123", "sub_123");

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // And: GitHub App has multiple repos available
      fakeGitHubAppService.setRepos([
        {
          id: 1001,
          full_name: "paid-org/repo-one",
          private: false,
          owner: { login: "paid-org" },
          name: "repo-one",
        },
        {
          id: 1002,
          full_name: "paid-org/repo-two",
          private: false,
          owner: { login: "paid-org" },
          name: "repo-two",
        },
        {
          id: 1003,
          full_name: "paid-org/repo-three",
          private: true,
          owner: { login: "paid-org" },
          name: "repo-three",
        },
      ]);

      // When: user selects 3 repos including a private one
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/repositories",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "repositories=1001&repositories=1002&repositories=1003",
      });

      // Then: redirects to onboarding complete (success)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding/complete");

      // And: all repositories are saved
      const savedRepos = await repositoryRepo.findByAccountId(account._id);
      expect(savedRepos).toHaveLength(3);
    });

    it("should allow free plan to select one public repo", async () => {
      // Given: an account on free plan
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org-one",
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
          full_name: "free-org/repo-one",
          private: false,
          owner: { login: "free-org" },
          name: "repo-one",
        },
      ]);

      // When: user selects 1 public repo (within free plan limits)
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/repositories",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "repositories=1001",
      });

      // Then: redirects to onboarding complete (success)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding/complete");

      // And: repository is saved
      const savedRepos = await repositoryRepo.findByAccountId(account._id);
      expect(savedRepos).toHaveLength(1);
    });
  });
});
