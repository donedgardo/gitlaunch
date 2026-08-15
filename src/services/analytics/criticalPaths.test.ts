import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import EventEmitter from "node:events";
import { FastifyInstance } from "fastify";
import { createAppServer } from "../../server/createAppServer";
import { MongoDbClient } from "../auth/mongoDbClient";
import { SessionService } from "../auth/sessionService";
import { AccountRepository } from "../../repositories/accountRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { ApiKeyRepository } from "../../repositories/apiKeyRepository";
import { ApiKeyService } from "../apiKey/apiKeyService";
import { GitHubOAuthService } from "../auth/githubOAuthService";
import {
  FakeGitHubHttpClient,
  FakeGitHubApiClient,
  FakeGitHubAppClient,
} from "../github/fakes";
import { GitHubAppService } from "../github/githubAppService";
import { InstallationTokenService } from "../github/installationTokenService";
import { WebhookEventRepository } from "../../repositories/webhookEventRepository";
import { AnalyticsService } from "./analytics";

class SpyAnalytics implements AnalyticsService {
  calls: { method: string; args: any[] }[] = [];

  identify(userId: string, traits: Record<string, any>) {
    this.calls.push({ method: "identify", args: [userId, traits] });
  }
  track(event: string, properties?: Record<string, any>) {
    this.calls.push({ method: "track", args: [event, properties] });
  }
  navigation(destination: string, properties?: Record<string, any>) {
    this.calls.push({ method: "navigation", args: [destination, properties] });
  }

  eventNames(): string[] {
    return this.calls.filter((c) => c.method === "track").map((c) => c.args[0]);
  }

  hasEvent(name: string): boolean {
    return this.eventNames().includes(name);
  }

  reset() {
    this.calls = [];
  }
}

describe("Critical Path Analytics Integration", () => {
  let mongoServer: MongoMemoryServer;
  let mongoClient: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let analytics: SpyAnalytics;
  let sessionService: SessionService;
  let accountRepo: AccountRepository;
  let serviceRepo: ServiceRepository;
  let repositoryRepo: RepositoryRepository;
  let apiKeyService: ApiKeyService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    mongoClient = new MongoClient(mongoServer.getUri());
    await mongoClient.connect();
    db = mongoClient.db("test");
  });

  afterAll(async () => {
    await mongoClient.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.collection(col.name).deleteMany({});
    }

    analytics = new SpyAnalytics();
    sessionService = new SessionService("test-secret");
    accountRepo = new AccountRepository(db);
    serviceRepo = new ServiceRepository(db);
    repositoryRepo = new RepositoryRepository(db);
    const apiKeyRepo = new ApiKeyRepository(db);
    apiKeyService = new ApiKeyService(apiKeyRepo, accountRepo);

    const githubOAuthService = new GitHubOAuthService(
      new FakeGitHubHttpClient(),
      {
        clientId: "test",
        clientSecret: "test",
        redirectUri: "http://localhost/auth/github/callback",
      },
    );
    const installationTokenService = new InstallationTokenService(
      new FakeGitHubAppClient(),
    );
    const gitHubAppService = new GitHubAppService(
      accountRepo,
      installationTokenService,
      new FakeGitHubApiClient(),
    );
    const webhookEventRepo = new WebhookEventRepository(db);

    app = createAppServer({
      database: db,
      mongoClient: new MongoDbClient(mongoClient),
      eventEmitter: new EventEmitter(),
      githubOAuthService,
      sessionService,
      gitHubAppService,
      installationTokenService,
      webhookEventRepo,
      analytics,
    });

    await app.ready();
  });

  function getSessionCookie(response: any): string {
    const cookies = response.cookies as any[];
    return cookies.find((c: any) => c.name === "session")?.value ?? "";
  }

  describe("New user to first build", () => {
    it("should track the full journey: login → plan → github install → repos → service → build", async () => {
      // 1. Login
      const loginRes = await app.inject({
        method: "GET",
        url: "/auth/github/callback?code=test&state=test",
      });
      expect(loginRes.statusCode).toBe(302);
      const session = getSessionCookie(loginRes);

      expect(analytics.calls[0].method).toBe("identify");
      expect(analytics.hasEvent("user_logged_in")).toBe(true);

      // 2. Select plan
      await app.inject({
        method: "POST",
        url: "/onboarding/select-plan",
        cookies: { session },
        payload: { plan: "pro" },
      });
      expect(analytics.hasEvent("plan_selected")).toBe(true);
      expect(analytics.hasEvent("trial_started")).toBe(true);

      // 3. Install GitHub App
      await app.inject({
        method: "GET",
        url: "/github/installation/callback?installation_id=12345",
        cookies: { session },
      });
      expect(analytics.hasEvent("github_app_installed")).toBe(true);

      // 4. Select repositories
      await app.inject({
        method: "POST",
        url: "/onboarding/repositories",
        cookies: { session },
        payload: { repositories: "100001" },
      });
      expect(analytics.hasEvent("repositories_selected")).toBe(true);

      // 5. Create service — one canonical path, whether or not this is the
      // account's first service.
      const account = await accountRepo.findBySlug("dev-user");
      await app.inject({
        method: "POST",
        url: "/onboarding/service",
        cookies: { session },
        payload: { name: "my-api" },
      });
      expect(analytics.hasEvent("service_created")).toBe(true);

      // 6. Report build via API
      const services = await serviceRepo.findByAccountId(account!._id);
      const { key } = await apiKeyService.generate({
        accountId: account!._id,
        createdByUserId: new ObjectId(),
        name: "test",
        scopes: ["builds:read", "builds:write"],
      });

      const buildRes = await app.inject({
        method: "POST",
        url: `/api/v1/services/${services[0]._id}/builds`,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        payload: { buildId: "sha-abc" },
      });
      expect(buildRes.statusCode).toBe(201);
      expect(analytics.hasEvent("build_reported")).toBe(true);

      // Verify ordering
      const events = analytics.eventNames();
      const order = [
        "user_logged_in",
        "plan_selected",
        "github_app_installed",
        "repositories_selected",
        "service_created",
        "build_reported",
      ];
      for (let i = 0; i < order.length - 1; i++) {
        expect(events.indexOf(order[i])).toBeLessThan(
          events.indexOf(order[i + 1]),
        );
      }
    });
  });

  describe("New user to first deployment", () => {
    it("should track workflow configured and deployment after build", async () => {
      // Setup: account with service and a build
      const account = await accountRepo.create({ name: "Org", slug: "org" });
      const userId = new ObjectId();
      const repo = await repositoryRepo.create({
        accountId: account._id,
        githubRepoId: 1,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "my-svc",
      });
      const { key } = await apiKeyService.generate({
        accountId: account._id,
        createdByUserId: userId,
        name: "key",
        scopes: ["builds:read", "builds:write", "deployments:write"],
      });
      const session = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // Report build
      await app.inject({
        method: "POST",
        url: `/api/v1/services/${service._id}/builds`,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        payload: { buildId: "sha-1" },
      });
      expect(analytics.hasEvent("build_reported")).toBe(true);

      // Configure workflow
      await app.inject({
        method: "PATCH",
        url: `/services/${service._id}/workflow`,
        cookies: { session },
        payload: { workflowFile: "deploy.yml" },
      });
      expect(analytics.hasEvent("workflow_configured")).toBe(true);

      // Deploy
      await app.inject({
        method: "PATCH",
        url: `/api/v1/services/${service._id}/builds/sha-1/deploy/staging`,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        payload: { status: "deployed" },
      });
      expect(analytics.hasEvent("deployment_status_updated")).toBe(true);

      // Verify ordering
      const events = analytics.eventNames();
      expect(events.indexOf("build_reported")).toBeLessThan(
        events.indexOf("workflow_configured"),
      );
      expect(events.indexOf("workflow_configured")).toBeLessThan(
        events.indexOf("deployment_status_updated"),
      );
    });
  });

  describe("Free to paid conversion", () => {
    it("should track new vs returning user on login", async () => {
      // First login — new user
      const res1 = await app.inject({
        method: "GET",
        url: "/auth/github/callback?code=test&state=test",
      });
      expect(res1.statusCode).toBe(302);
      const loginEvent1 = analytics.calls.find(
        (c) => c.method === "track" && c.args[0] === "user_logged_in",
      );
      expect(loginEvent1?.args[1].isNewUser).toBe(true);

      // Second login — returning user
      analytics.reset();
      const res2 = await app.inject({
        method: "GET",
        url: "/auth/github/callback?code=test&state=test",
      });
      expect(res2.statusCode).toBe(302);
      const loginEvent2 = analytics.calls.find(
        (c) => c.method === "track" && c.args[0] === "user_logged_in",
      );
      expect(loginEvent2?.args[1].isNewUser).toBe(false);
    });

    it("should track logout", async () => {
      // Login first
      const res = await app.inject({
        method: "GET",
        url: "/auth/github/callback?code=test&state=test",
      });
      const session = getSessionCookie(res);
      analytics.reset();

      // Logout
      await app.inject({
        method: "GET",
        url: "/auth/logout",
        cookies: { session },
      });
      expect(analytics.hasEvent("user_logged_out")).toBe(true);
    });
  });
});
