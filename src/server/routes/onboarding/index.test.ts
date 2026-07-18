import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import {
  AccountRepository,
  Plan,
} from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { UserRepository } from "../../../repositories/userRepository";
import { TrialRegistryRepository } from "../../../repositories/trialRegistryRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { TrialService } from "../../../services/billing/trialService";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { mockViewPlugin } from "../../testing/mockViewPlugin";
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
}

describe("Onboarding Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let repositoryRepo: RepositoryRepository;
  let membershipRepo: MembershipRepository;
  let userRepo: UserRepository;
  let trialRegistryRepo: TrialRegistryRepository;
  let planEnforcementService: PlanEnforcementService;
  let trialService: TrialService;
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
    await db.collection("services").deleteMany({});
    await db.collection("memberships").deleteMany({});
    await db.collection("users").deleteMany({});
    await db.collection("trialRegistry").deleteMany({});

    accountRepo = new AccountRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    const serviceRepo = new ServiceRepository(db);
    membershipRepo = new MembershipRepository(db);
    userRepo = new UserRepository(db);
    trialRegistryRepo = new TrialRegistryRepository(db);
    await trialRegistryRepo.ensureIndexes();

    planEnforcementService = new PlanEnforcementService(
      accountRepo,
      repositoryRepo,
      serviceRepo,
      membershipRepo,
    );
    trialService = new TrialService(accountRepo, trialRegistryRepo);
    fakeGitHubAppService = new FakeGitHubAppService();
    sessionService = new SessionService(TEST_SECRET);

    app = Fastify();
    await app.register(cookie, { secret: COOKIE_SECRET });
    await app.register(formbody);
    await app.register(mockViewPlugin);
    sessionAuthMiddleware(app, sessionService);
    registerOnboardingRoutes(app, {
      accountRepository: accountRepo,
      repositoryRepository: repositoryRepo,
      userRepository: userRepo,
      gitHubAppService: fakeGitHubAppService as unknown as GitHubAppService,
      planEnforcementService,
      trialService,
    });
    await app.ready();
  });

  describe("GET /onboarding/plan-selection", () => {
    it("should render plan selection template for authenticated users", async () => {
      // Given: an authenticated user with a new account
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: user visits plan selection page
      const response = await app.inject({
        method: "GET",
        url: "/onboarding/plan-selection",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: page renders successfully
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Choose your plan");
    });

    it("should redirect to login if not authenticated", async () => {
      // When: unauthenticated user visits plan selection
      const response = await app.inject({
        method: "GET",
        url: "/onboarding/plan-selection",
      });

      // Then: redirects to GitHub OAuth login
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/auth/github");
    });

    it("should redirect to onboarding if account already has non-Free plan", async () => {
      // Given: an account with Pro plan already set
      const account = await accountRepo.create({
        name: "Pro Org",
        slug: "pro-org",
      });
      await accountRepo.selectPlan(account._id, Plan.Pro);

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: user visits plan selection page
      const response = await app.inject({
        method: "GET",
        url: "/onboarding/plan-selection",
        cookies: {
          session: sessionToken,
        },
      });

      // Then: redirects to GitHub App install (skip plan selection)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding");
    });
  });

  describe("POST /onboarding/select-plan", () => {
    it("should set Free plan and redirect to onboarding", async () => {
      // Given: an authenticated user with a new account
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: user selects Free plan
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/select-plan",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "plan=free",
      });

      // Then: redirects to GitHub App install
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding");

      // And: account plan is set to Free
      const updatedAccount = await accountRepo.findById(account._id);
      expect(updatedAccount?.plan).toBe(Plan.Free);
      expect(updatedAccount?.planLimits.maxRepositories).toBe(3);
    });

    it("should set Pro plan and redirect to onboarding", async () => {
      // Given: an authenticated user with a new account
      const account = await accountRepo.create({
        name: "Pro Org",
        slug: "pro-org",
      });

      const user = await userRepo.create({
        githubId: 12345,
        githubLogin: "testuser",
        email: "test@example.com",
        name: "Test User",
        avatarUrl: null,
      });

      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: user selects Pro plan
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/select-plan",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "plan=pro",
      });

      // Then: redirects to GitHub App install
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding");

      // And: account plan is set to Pro
      const updatedAccount = await accountRepo.findById(account._id);
      expect(updatedAccount?.plan).toBe(Plan.Pro);
      expect(updatedAccount?.planLimits.maxRepositories).toBe(10);
    });

    it("should set Team plan and redirect to onboarding", async () => {
      // Given: an authenticated user with a new account
      const account = await accountRepo.create({
        name: "Team Org",
        slug: "team-org",
      });

      const user = await userRepo.create({
        githubId: 67890,
        githubLogin: "teamuser",
        email: "team@example.com",
        name: "Team User",
        avatarUrl: null,
      });

      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId: account._id,
      });

      // When: user selects Team plan
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/select-plan",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "plan=team",
      });

      // Then: redirects to GitHub App install
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding");

      // And: account plan is set to Team
      const updatedAccount = await accountRepo.findById(account._id);
      expect(updatedAccount?.plan).toBe(Plan.Team);
      expect(updatedAccount?.planLimits.maxRepositories).toBe(999);
    });

    it("should return error for invalid plan", async () => {
      // Given: an authenticated user with a new account
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-invalid",
      });

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: user submits invalid plan
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/select-plan",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "plan=invalid",
      });

      // Then: returns 400 error
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Invalid plan" });
    });

    it("should redirect to login if not authenticated", async () => {
      // When: unauthenticated user submits plan selection
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/select-plan",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "plan=free",
      });

      // Then: redirects to GitHub OAuth login
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/auth/github");
    });
  });

  describe("POST /onboarding/repositories", () => {
    it("should save selected repositories to the account", async () => {
      // Given: an account with GitHub App installed (paid plan to allow multiple repos)
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      await accountRepo.updateInstallation(account._id, 12345);
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_test",
        "sub_test",
        Plan.Pro,
      );

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

      // Then: redirects to dashboard (API key shown when creating service)
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

  describe("Plan Enforcement", () => {
    it("should reject selecting more repos than free plan allows", async () => {
      // Given: an account on free plan (maxRepositories: 3)
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
        {
          id: 1003,
          full_name: "free-org/repo-three",
          private: false,
          owner: { login: "free-org" },
          name: "repo-three",
        },
        {
          id: 1004,
          full_name: "free-org/repo-four",
          private: false,
          owner: { login: "free-org" },
          name: "repo-four",
        },
      ]);

      // When: user tries to select 4 repos (exceeds free plan limit of 3)
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/repositories",
        cookies: {
          session: sessionToken,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        payload:
          "repositories=1001&repositories=1002&repositories=1003&repositories=1004",
      });

      // Then: returns 200 with error message in rendered view
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Repository limit reached");
      expect(response.body).toContain("0/3");

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

      // Then: returns 200 with error message in rendered view
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(
        "Private repositories require a paid plan",
      );

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
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_123",
        "sub_123",
        Plan.Pro,
      );

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

      // Then: redirects to dashboard (success)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");

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

      // Then: redirects to dashboard (success)
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");

      // And: repository is saved
      const savedRepos = await repositoryRepo.findByAccountId(account._id);
      expect(savedRepos).toHaveLength(1);
    });

    it("should reject repos when existing + new would exceed free plan limit", async () => {
      // Given: an account on free plan with GitHub App installed
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org-existing",
      });
      await accountRepo.updateInstallation(account._id, 12345);

      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // And: account already has 2 repositories saved in the database
      await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 2001,
        githubFullName: "free-org/existing-repo-one",
        githubOwner: "free-org",
        githubRepoName: "existing-repo-one",
        isPrivate: false,
      });
      await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 2002,
        githubFullName: "free-org/existing-repo-two",
        githubOwner: "free-org",
        githubRepoName: "existing-repo-two",
        isPrivate: false,
      });

      // And: GitHub App returns 2 more repos available
      fakeGitHubAppService.setRepos([
        {
          id: 1001,
          full_name: "free-org/new-repo-one",
          private: false,
          owner: { login: "free-org" },
          name: "new-repo-one",
        },
        {
          id: 1002,
          full_name: "free-org/new-repo-two",
          private: false,
          owner: { login: "free-org" },
          name: "new-repo-two",
        },
      ]);

      // When: user selects 2 new repos (batch of 2, which is under the limit of 3)
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

      // Then: should return 200 with error message about repository limit
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Repository limit reached");
      expect(response.body).toContain("2/3");

      // And: no new repositories should be saved (still 2)
      const savedRepos = await repositoryRepo.findByAccountId(account._id);
      expect(savedRepos).toHaveLength(2);
    });
  });
});
