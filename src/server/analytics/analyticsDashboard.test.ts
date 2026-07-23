import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import EventEmitter from "node:events";
import { FastifyInstance } from "fastify";
import * as cheerio from "cheerio";
import { createAppServer } from "../createAppServer";
import { MongoDbClient } from "../../services/auth/mongoDbClient";
import { SessionService } from "../../services/auth/sessionService";
import { AccountRepository } from "../../repositories/accountRepository";
import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { GitHubOAuthService } from "../../services/auth/githubOAuthService";
import {
  FakeGitHubHttpClient,
  FakeGitHubApiClient,
  FakeGitHubAppClient,
} from "../../services/github/fakes";
import { GitHubAppService } from "../../services/github/githubAppService";
import { InstallationTokenService } from "../../services/github/installationTokenService";
import { WebhookEventRepository } from "../../repositories/webhookEventRepository";

describe("Analytics dashboard", () => {
  let mongoServer: MongoMemoryServer;
  let mongoClient: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let sessionService: SessionService;
  let accountRepo: AccountRepository;
  let analyticsRepo: AnalyticsEventRepository;

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

    sessionService = new SessionService("test-secret");
    accountRepo = new AccountRepository(db);
    analyticsRepo = new AnalyticsEventRepository(db);

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
    });

    await app.ready();
  });

  async function seedRecent(
    accountId: ObjectId,
    event: string,
    distinctId: string,
    properties: Record<string, any> = {},
  ) {
    await analyticsRepo.insert({
      type: "track",
      event,
      accountId,
      distinctId,
      properties,
      timestamp: new Date(), // within the default range
    });
  }

  it("should render aggregated metrics for the logged-in account", async () => {
    // Given: an account with three events from two distinct users
    const account = await accountRepo.create({ name: "Org", slug: "org" });
    const session = sessionService.createSession({
      userId: new ObjectId(),
      accountId: account._id,
    });
    await seedRecent(account._id, "deployment_triggered", "user-1", {
      environment: "prod",
    });
    await seedRecent(account._id, "deployment_triggered", "user-2", {
      environment: "staging",
    });
    await seedRecent(account._id, "user_logged_in", "user-1");

    // When: I open the analytics dashboard
    const res = await app.inject({
      method: "GET",
      url: "/dashboard/analytics",
      cookies: { session },
    });

    // Then: it renders with the account's aggregates
    expect(res.statusCode).toBe(200);
    const $ = cheerio.load(res.body);
    expect($('[data-testid="kpi-total-events"]').text()).toContain("3");
    expect($('[data-testid="kpi-unique-users"]').text()).toContain("2");
    expect($('[data-testid="top-events"]').text()).toContain(
      "deployment_triggered",
    );
  });

  it("should not show another account's events", async () => {
    // Given: my account has one event and another account has a secret event
    const mine = await accountRepo.create({ name: "Mine", slug: "mine" });
    const other = await accountRepo.create({ name: "Other", slug: "other" });
    const session = sessionService.createSession({
      userId: new ObjectId(),
      accountId: mine._id,
    });
    await seedRecent(mine._id, "my_event", "u1");
    await seedRecent(other._id, "secret_other_event", "u9");

    // When: I open my analytics dashboard
    const res = await app.inject({
      method: "GET",
      url: "/dashboard/analytics",
      cookies: { session },
    });

    // Then: only my event is present; the other account's is not
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("my_event");
    expect(res.body).not.toContain("secret_other_event");
  });

  it("should redirect anonymous visitors away", async () => {
    // Given: no session
    // When: I try to open the analytics dashboard
    const res = await app.inject({
      method: "GET",
      url: "/dashboard/analytics",
    });

    // Then: I'm redirected to the landing page
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
  });
});
