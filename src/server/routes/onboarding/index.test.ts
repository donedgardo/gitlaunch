import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import {
  AccountRepository,
  Plan,
} from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { UserRepository } from "../../../repositories/userRepository";
import { TrialRegistryRepository } from "../../../../ee/repositories/trialRegistryRepository";
import { ApiKeyRepository } from "../../../repositories/apiKeyRepository";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { PlanEnforcementService } from "../../../../ee/services/billing/planEnforcementService";
import { TrialService } from "../../../../ee/services/billing/trialService";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { mockViewPlugin } from "../../testing/mockViewPlugin";
import { registerHandlebarsHelpers } from "../../registerHandlebarsHelpers";
import { registerOnboardingRoutes, OnboardingRoutesDeps } from "./index";

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
  let serviceRepo: ServiceRepository;
  let membershipRepo: MembershipRepository;
  let userRepo: UserRepository;
  let trialRegistryRepo: TrialRegistryRepository;
  let apiKeyService: ApiKeyService;
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
    registerHandlebarsHelpers();
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  // Route configuration is a dependency now, not ambient process.env. Tests
  // that need a different configuration mount their own app and say so.
  const onboardingDeps = (): OnboardingRoutesDeps => ({
    cookieSecure: false,
    publicUrl: "http://localhost:3050",
    github: { useFakes: false, appName: "gitlaunchapp" },
    buildSimulationEnabled: false,
    accountRepository: accountRepo,
    repositoryRepository: repositoryRepo,
    userRepository: userRepo,
    serviceRepository: serviceRepo,
    gitHubAppService: fakeGitHubAppService as unknown as GitHubAppService,
    apiKeyService,
    planEnforcementService,
    trialService,
  });

  async function mountOnboarding(
    overrides: Partial<OnboardingRoutesDeps> = {},
  ): Promise<FastifyInstance> {
    const local = Fastify();
    await local.register(cookie, { secret: COOKIE_SECRET });
    await local.register(formbody);
    await local.register(mockViewPlugin);
    sessionAuthMiddleware(local, sessionService);
    registerOnboardingRoutes(local, { ...onboardingDeps(), ...overrides });
    await local.ready();
    return local;
  }

  // The mock view plugin only echoes the template name and a little data, so
  // it can say nothing about what the customer actually reads. Assertions
  // about on-screen copy mount the real Handlebars engine instead.
  async function mountOnboardingWithRealViews(
    overrides: Partial<OnboardingRoutesDeps> = {},
  ): Promise<FastifyInstance> {
    const local = Fastify();
    await local.register(cookie, { secret: COOKIE_SECRET });
    await local.register(formbody);
    await local.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: {
        partials: {
          aiAgentSetup: "/partials/aiAgentSetup.hbs",
          buildReportingInstructions:
            "/partials/buildReportingInstructions.hbs",
          deploymentSetupGuide: "/partials/deploymentSetupGuide.hbs",
          githubSecretsSetup: "/partials/githubSecretsSetup.hbs",
          jenkinsBuildReportingGuide:
            "/partials/jenkinsBuildReportingGuide.hbs",
          jenkinsDeploymentGuide: "/partials/jenkinsDeploymentGuide.hbs",
          rawBuildReportingGuide: "/partials/rawBuildReportingGuide.hbs",
          gitlabBuildReportingGuide: "/partials/gitlabBuildReportingGuide.hbs",
          onboardingProgress: "/partials/onboardingProgress.hbs",
        },
      },
    });
    sessionAuthMiddleware(local, sessionService);
    registerOnboardingRoutes(local, { ...onboardingDeps(), ...overrides });
    await local.ready();
    return local;
  }

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});
    await db.collection("services").deleteMany({});
    await db.collection("memberships").deleteMany({});
    await db.collection("users").deleteMany({});
    await db.collection("trialRegistry").deleteMany({});
    await db.collection("apiKeys").deleteMany({});

    accountRepo = new AccountRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    serviceRepo = new ServiceRepository(db);
    membershipRepo = new MembershipRepository(db);
    userRepo = new UserRepository(db);
    trialRegistryRepo = new TrialRegistryRepository(db);
    await trialRegistryRepo.ensureIndexes();
    apiKeyService = new ApiKeyService(new ApiKeyRepository(db), accountRepo);

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
    registerOnboardingRoutes(app, onboardingDeps());
    await app.ready();
  });

  describe("GET /onboarding — retired provider fork", () => {
    // The old choose-a-CI-provider fork is gone: provider choice now happens
    // per service in the deploy-setup step. The legacy entry point just forwards
    // to the dashboard so old bookmarks don't 404.
    it("redirects to the dashboard when nothing is connected", async () => {
      const account = await accountRepo.create({
        name: "Fork Org",
        slug: "fork-org",
      });
      const sessionToken = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const response = await app.inject({
        method: "GET",
        url: "/onboarding",
        cookies: { session: sessionToken },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");
    });

    it("redirects to the dashboard when GitHub is connected", async () => {
      const account = await accountRepo.create({
        name: "Gh Org",
        slug: "gh-org",
      });
      await accountRepo.updateInstallation(account._id, 12345);
      const sessionToken = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });

      const response = await app.inject({
        method: "GET",
        url: "/onboarding",
        cookies: { session: sessionToken },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/dashboard");
    });
  });

  describe("Reporting-first onboarding (service → report builds)", () => {
    async function authedAccount(slug: string) {
      const account = await accountRepo.create({ name: slug, slug });
      const session = sessionService.createSession({
        userId: new ObjectId(),
        accountId: account._id,
      });
      return { account, session };
    }

    it("plan selection leads to service creation", async () => {
      const { session } = await authedAccount("plan-org");
      const response = await app.inject({
        method: "POST",
        url: "/onboarding/select-plan",
        cookies: { session },
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "plan=free",
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/onboarding/service");
    });

    it("creates a report-only service from just a name and advances to report-builds", async () => {
      const { account, session } = await authedAccount("svc-org");

      const response = await app.inject({
        method: "POST",
        url: "/onboarding/service",
        cookies: { session },
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "name=api",
      });

      // Redirects into the report-builds step for the new service
      expect(response.statusCode).toBe(302);
      const created = await serviceRepo.findByAccountIdAndName(
        account._id,
        "api",
      );
      expect(created).not.toBeNull();
      // repoUrl (for SHA links) is set up later, not in this wizard
      expect(created?.repoUrl).toBe("");
      // CD is not configured yet — that's the deploy-setup step
      expect(created?.deployment).toBeNull();
      expect(response.headers.location).toBe(
        `/onboarding/report-builds/${created?._id}`,
      );
    });

    it("re-renders the form with an error when the name is missing", async () => {
      const { account, session } = await authedAccount("empty-org");

      const response = await app.inject({
        method: "POST",
        url: "/onboarding/service",
        cookies: { session },
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "name=",
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('data-template="onboarding/service"');
      const services = await serviceRepo.findByAccountId(account._id);
      expect(services).toHaveLength(0);
    });

    it("renders the report-builds guide for an owned service", async () => {
      const { account, session } = await authedAccount("guide-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
        repoUrl: "https://github.com/acme/api",
      });

      const response = await app.inject({
        method: "GET",
        url: `/onboarding/report-builds/${service._id}`,
        cookies: { session },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(
        'data-template="onboarding/report-builds"',
      );
    });

    it("tells the agent user their first build lands when the pull request merges", async () => {
      // The agent path always opens a pull request (the skill forbids pushing
      // to the default branch) and the build-report step is gated to the
      // default branch — so a flawless agent run leaves this page unchanged
      // until the merge. The page used to promise it "advances on its own as
      // soon as your first build reaches GitLaunch", which dead-ends the
      // customer at the exact moment they decide whether GitLaunch works.
      const { account, session } = await authedAccount("agent-wait-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
      });

      const realApp = await mountOnboardingWithRealViews();
      const response = await realApp.inject({
        method: "GET",
        url: `/onboarding/report-builds/${service._id}`,
        cookies: { session },
      });
      await realApp.close();

      expect(response.statusCode).toBe(200);
      // The customer is told what they are waiting for, and on what condition.
      // The branch is described, never named: a service is created from a name
      // alone — no repo, no GitHub installation — so the server cannot know
      // whether this repo's default branch is "main".
      expect(response.body).toContain("Your first build arrives on merge");
      expect(response.body).toContain(
        "instead of pushing straight to your default branch",
      );
      expect(response.body).toContain(
        "Nothing lands here until that pull request merges",
      );
      // This page — and only this page — does advance by itself once the
      // build lands, so it is the one place that may still say so.
      expect(response.body).toContain(
        "this page moves on by itself when it lands",
      );
      // No unconditional promise that the page moves on by itself
      expect(response.body).not.toContain(
        "advances on its own as soon as your first build reaches GitLaunch",
      );
      // No "View pull request" button: nothing server-side knows the PR. The
      // only webhook receiver is Stripe's, so a link here would be invented.
      expect(response.body).not.toContain("View pull request");
      // ...and the live stream that does eventually advance the page survives
      expect(response.body).toContain(`/build-created-stream/${service._id}`);
    });

    it("offers a GitLab CI build-report job next to GitHub Actions and Jenkins", async () => {
      // A user whose repo lives on GitLab used to find only GitHub Actions,
      // Jenkins and a bare curl here, and the agent — following the same
      // surfaces — handed them a GitHub Actions workflow for a GitLab repo.
      const { account, session } = await authedAccount("gitlab-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
      });

      const realApp = await mountOnboardingWithRealViews();
      const response = await realApp.inject({
        method: "GET",
        url: `/onboarding/report-builds/${service._id}`,
        cookies: { session },
      });
      await realApp.close();

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("GitLab CI");
      // The job is the canonical one from the snippet generator, addressed to
      // this instance, gated to GitLab's own notion of the default branch.
      expect(response.body).toContain("report_build:");
      expect(response.body).toContain(
        `http://localhost:3050/api/v1/services/${service._id}/builds`,
      );
      expect(response.body).toContain(
        "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH",
      );
    });

    it("shows the whole onboarding path so a newcomer knows what step this is and why", async () => {
      // Watching a first-time user: they copied the agent prompt without being
      // able to say what they were setting up, or what would happen after. A
      // nav caption reading "Step 2 of 3" names a position, not a plan.
      const { account, session } = await authedAccount("orient-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
      });

      const realApp = await mountOnboardingWithRealViews();
      const response = await realApp.inject({
        method: "GET",
        url: `/onboarding/report-builds/${service._id}`,
        cookies: { session },
      });
      await realApp.close();

      expect(response.statusCode).toBe(200);
      // All three steps are named, in order, on this page
      const body = response.body;
      const create = body.indexOf("Create a service");
      const report = body.indexOf("Report builds", create);
      const deploy = body.indexOf("Connect deploys", report);
      expect(create).toBeGreaterThan(-1);
      expect(report).toBeGreaterThan(create);
      expect(deploy).toBeGreaterThan(report);
      // ...and the loop being wired is spelled out in plain words: CI tells
      // GitLaunch about a build, GitLaunch tells CI to deploy it.
      expect(body).toContain("Your CI tells GitLaunch about each build");
      expect(body).toContain("GitLaunch tells your CI to deploy one");
    });

    it("offers a dev-mode simulate-build button when ENABLE_BUILD_SIMULATION is on", async () => {
      const { account, session } = await authedAccount("dev-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
      });

      const local = await mountOnboarding({ buildSimulationEnabled: true });
      const response = await local.inject({
        method: "GET",
        url: `/onboarding/report-builds/${service._id}`,
        cookies: { session },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("simulate-build-btn");
    });

    it("hides the simulate-build button when not in dev mode", async () => {
      const { account, session } = await authedAccount("prod-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
      });

      const response = await app.inject({
        method: "GET",
        url: `/onboarding/report-builds/${service._id}`,
        cookies: { session },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("simulate-build-btn");
    });

    it("renders a full setup-deploy page (not a blank one) with the real view engine", async () => {
      // Regression: the mock view sends synchronously, so it can't catch an
      // unreturned async reply.view — which made the real page render blank
      // (HTTP 200, empty body) after a build was reported. Use the real
      // @fastify/view engine + layout to guard against that.
      const { account, session } = await authedAccount("realview-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
      });

      const realApp = await mountOnboardingWithRealViews();

      const response = await realApp.inject({
        method: "GET",
        url: `/onboarding/setup-deploy/${service._id}`,
        cookies: { session },
      });
      await realApp.close();

      expect(response.statusCode).toBe(200);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body).toContain("Set up deployments");
    });

    // A self-hosted install was handing onboarding customers CI YAML that
    // POSTs to gitlaunch.dev with their own API key in the Authorization
    // header — their builds land in our database, not theirs, and their
    // credential goes to a third party. The guides must name this instance.
    it("addresses the onboarding GitHub Actions guides to this instance, not the hosted one", async () => {
      const { account, session } = await authedAccount("selfhosted-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
      });

      const realApp = Fastify();
      await realApp.register(cookie, { secret: COOKIE_SECRET });
      await realApp.register(formbody);
      await realApp.register(view, {
        engine: { handlebars },
        root: path.join(__dirname, "../../../templates"),
        options: {
          compileOptions: { preventIndent: true },
          partials: {
            buildReportingInstructions:
              "/partials/buildReportingInstructions.hbs",
            deploymentSetupGuide: "/partials/deploymentSetupGuide.hbs",
            jenkinsBuildReportingGuide:
              "/partials/jenkinsBuildReportingGuide.hbs",
            jenkinsDeploymentGuide: "/partials/jenkinsDeploymentGuide.hbs",
            rawBuildReportingGuide: "/partials/rawBuildReportingGuide.hbs",
            githubSecretsSetup: "/partials/githubSecretsSetup.hbs",
            aiAgentSetup: "/partials/aiAgentSetup.hbs",
          },
        },
      });
      sessionAuthMiddleware(realApp, sessionService);
      registerOnboardingRoutes(realApp, onboardingDeps());
      await realApp.ready();

      const reportBuilds = await realApp.inject({
        method: "GET",
        url: `/onboarding/report-builds/${service._id}`,
        cookies: { session },
      });
      const setupDeploy = await realApp.inject({
        method: "GET",
        url: `/onboarding/setup-deploy/${service._id}`,
        cookies: { session },
      });
      await realApp.close();

      expect(reportBuilds.statusCode).toBe(200);
      expect(reportBuilds.body).toContain(
        "http://localhost:3050/api/v1/services/",
      );
      expect(reportBuilds.body).not.toContain("gitlaunch.dev");

      expect(setupDeploy.statusCode).toBe(200);
      expect(setupDeploy.body).toContain(
        "http://localhost:3050/api/v1/services/",
      );
      expect(setupDeploy.body).not.toContain("gitlaunch.dev");
    });

    it("repo selection without a GitHub connection sends the user to install (fake), preserving returnTo", async () => {
      // Regression: retiring the choose-provider fork made /onboarding redirect
      // to the dashboard, so the "don't see your repository?" link dead-ended
      // there. It must instead prompt a GitHub App install and come back.
      const { session } = await authedAccount("connect-fake-org");

      const local = await mountOnboarding({ github: { useFakes: true } });
      const response = await local.inject({
        method: "GET",
        url: "/onboarding/repositories?returnTo=/services/new",
        cookies: { session },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(
        `/github/installation/callback?installation_id=12345&returnTo=${encodeURIComponent("/services/new")}`,
      );
    });

    it("repo selection without a GitHub connection sends the user to the GitHub App (real)", async () => {
      const { session } = await authedAccount("connect-real-org");

      const response = await app.inject({
        method: "GET",
        url: "/onboarding/repositories?returnTo=/services/new",
        cookies: { session },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("github.com/apps/");
      expect(response.headers.location).toContain("/installations/new");
    });

    it("fake-github install link returns to setup-deploy after connecting", async () => {
      // In fake mode the install link hits our local callback directly, so it
      // can carry a returnTo — letting the connect flow come back to deploy
      // setup for local testing.
      const { account, session } = await authedAccount("fake-install-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
      });

      const local = await mountOnboarding({ github: { useFakes: true } });
      const response = await local.inject({
        method: "GET",
        url: `/onboarding/setup-deploy/${service._id}`,
        cookies: { session },
      });

      expect(response.statusCode).toBe(200);
      // fake callback link...
      expect(response.body).toContain("/github/installation/callback");
      // ...carrying a returnTo back to this service's deploy-setup step
      expect(response.body).toContain(
        `returnTo=${encodeURIComponent(`/onboarding/setup-deploy/${service._id}`)}`,
      );
    });

    it("returns 404 for a service the account does not own", async () => {
      const { session } = await authedAccount("outsider-org");
      const other = await accountRepo.create({ name: "Other", slug: "other" });
      const service = await serviceRepo.create({
        accountId: other._id,
        name: "secret",
        repoUrl: "https://github.com/other/secret",
      });

      const response = await app.inject({
        method: "GET",
        url: `/onboarding/report-builds/${service._id}`,
        cookies: { session },
      });

      expect(response.statusCode).toBe(404);
    });

    it("configures a raw webhook deployment and lands on the dashboard", async () => {
      const { account, session } = await authedAccount("raw-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
        repoUrl: "https://github.com/acme/api",
      });

      const response = await app.inject({
        method: "POST",
        url: `/onboarding/setup-deploy/${service._id}/raw`,
        cookies: { session },
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "endpointUrl=https://deploy.acme.com/hook",
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(`/dashboard/${service.name}`);
      const updated = await serviceRepo.findById(service._id);
      expect(updated?.deployment).toEqual({
        provider: "raw",
        endpointUrl: "https://deploy.acme.com/hook",
      });
    });

    it("configures a GitHub deployment from a connected repo", async () => {
      const { account, session } = await authedAccount("gh-cd-org");
      await accountRepo.updateInstallation(account._id, 12345);
      const repository = await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 7,
        githubFullName: "acme/api",
        githubRepoName: "api",
        githubOwner: "acme",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
        repoUrl: "https://github.com/acme/api",
      });

      const response = await app.inject({
        method: "POST",
        url: `/onboarding/setup-deploy/${service._id}/github`,
        cookies: { session },
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: `repositoryId=${repository._id}&workflowFile=ship.yml`,
      });

      expect(response.statusCode).toBe(302);
      const updated = await serviceRepo.findById(service._id);
      expect(updated?.deployment).toEqual({
        provider: "github",
        repositoryId: repository._id,
        workflowFile: "ship.yml",
      });
    });

    it("rejects a Jenkins deployment when Jenkins is not connected", async () => {
      const { account, session } = await authedAccount("jk-cd-org");
      const service = await serviceRepo.create({
        accountId: account._id,
        name: "api",
        repoUrl: "https://github.com/acme/api",
      });

      const response = await app.inject({
        method: "POST",
        url: `/onboarding/setup-deploy/${service._id}/jenkins`,
        cookies: { session },
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "jobName=deploy-api",
      });

      // Re-renders with an error; deployment stays unconfigured
      expect(response.statusCode).toBe(200);
      const updated = await serviceRepo.findById(service._id);
      expect(updated?.deployment).toBeNull();
    });
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
      expect(response.headers.location).toBe("/onboarding/service");
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
      expect(response.headers.location).toBe("/onboarding/service");

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
      expect(response.headers.location).toBe("/onboarding/service");

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
      expect(response.headers.location).toBe("/onboarding/service");

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
