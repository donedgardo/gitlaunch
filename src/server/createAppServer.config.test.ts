import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import EventEmitter from "node:events";
import { FastifyInstance } from "fastify";
import { createAppServer } from "./createAppServer";
import { loadConfig, Config } from "../config/loadConfig";
import { MongoDbClient } from "../services/auth/mongoDbClient";
import { SessionService } from "../services/auth/sessionService";
import { AccountRepository } from "../repositories/accountRepository";
import { GitHubOAuthService } from "../services/auth/githubOAuthService";
import {
  FakeGitHubHttpClient,
  FakeGitHubApiClient,
  FakeGitHubAppClient,
} from "../services/github/fakes";
import { GitHubAppService } from "../services/github/githubAppService";
import { InstallationTokenService } from "../services/github/installationTokenService";
import { WebhookEventRepository } from "../repositories/webhookEventRepository";

// Build a real Config through the real loader, so these tests exercise the
// same resolution rules production boots with rather than a hand-made object.
function testConfig(
  overrides: Record<string, string | undefined> = {},
): Config {
  return loadConfig(
    {
      PUBLIC_URL: "http://localhost:3050",
      MONGODB_URI: "mongodb://localhost:27017",
      COOKIE_SECRET_SIGNATURE: "test-secret",
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      USE_FAKE_GITHUB: "true",
      ...overrides,
    } as NodeJS.ProcessEnv,
    { distribution: "saas", issuerPublicKey: "" },
  );
}

describe("createAppServer configuration", () => {
  let mongoServer: MongoMemoryServer;
  let mongoClient: MongoClient;
  let db: Db;

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
  });

  async function buildServer(config: Config): Promise<FastifyInstance> {
    const accountRepo = new AccountRepository(db);
    const installationTokenService = new InstallationTokenService(
      new FakeGitHubAppClient(),
    );

    const app = createAppServer({
      database: db,
      mongoClient: new MongoDbClient(mongoClient),
      eventEmitter: new EventEmitter(),
      githubOAuthService: new GitHubOAuthService(new FakeGitHubHttpClient(), {
        clientId: "test",
        clientSecret: "test",
        redirectUri: "http://localhost/auth/github/callback",
      }),
      sessionService: new SessionService("test-secret"),
      gitHubAppService: new GitHubAppService(
        accountRepo,
        installationTokenService,
        new FakeGitHubApiClient(),
      ),
      installationTokenService,
      webhookEventRepo: new WebhookEventRepository(db),
      config,
    });

    await app.ready();
    return app;
  }

  describe("billing", () => {
    it("should not serve billing routes when Stripe is not configured", async () => {
      const app = await buildServer(testConfig());

      const response = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
      });

      expect(response.statusCode).toBe(404);
      await app.close();
    });

    it("should serve billing routes when Stripe is configured", async () => {
      const app = await buildServer(
        testConfig({ STRIPE_SECRET_KEY: "sk_test_123" }),
      );

      const response = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
      });

      // Unauthenticated, so it will not succeed — but it must not 404, which
      // is what proves the route was registered.
      expect(response.statusCode).not.toBe(404);
      await app.close();
    });

    it("should not serve billing routes on a self-hosted install", async () => {
      // Entitlement there comes from the license, so a checkout flow would be
      // a way to grant plan limits we never sold.
      const selfHosted = loadConfig(
        {
          PUBLIC_URL: "http://localhost:3050",
          MONGODB_URI: "mongodb://localhost:27017",
          COOKIE_SECRET_SIGNATURE: "test-secret",
          ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
          STRIPE_SECRET_KEY: "sk_test_leftover",
        } as NodeJS.ProcessEnv,
        { distribution: "self-hosted", issuerPublicKey: "pk" },
      );

      const app = await buildServer(selfHosted);

      const response = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
      });

      expect(response.statusCode).toBe(404);
      await app.close();
    });
  });

  describe("delivery metrics", () => {
    it("should serve the DORA metrics route", async () => {
      // A metric nothing can ask for is not a feature. The four keys shipped
      // computable but unreachable, so the assembled server — not just the
      // route module — has to be the thing under test.
      const app = await buildServer(testConfig());

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/services/000000000000000000000000/dora?environment=prod",
      });

      // Unauthenticated, so it will not succeed — but it must not 404, which
      // is what proves the route was registered.
      expect(response.statusCode).not.toBe(404);
      expect(response.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("MCP server", () => {
    it("should serve the MCP endpoint, behind API key auth", async () => {
      // Same reasoning as the metrics route above: the endpoint is only a
      // feature once the assembled server answers on it.
      const app = await buildServer(testConfig());

      const response = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      });

      expect(response.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("browser analytics snippet", () => {
    it("should load PostHog in the page when a project token is configured", async () => {
      // Session recordings and autocapture happen in the browser, so the
      // marketing pages have to actually ship the loader — a server-side sink
      // alone records nothing of what a visitor saw.
      const app = await buildServer(
        testConfig({ POSTHOG_PROJECT_TOKEN: "phc_test_token" }),
      );

      const response = await app.inject({ method: "GET", url: "/" });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("posthog.init('phc_test_token'");
      expect(response.body).toContain("https://us.i.posthog.com");
      await app.close();
    });

    it("should point the loader at the configured PostHog host", async () => {
      const app = await buildServer(
        testConfig({
          POSTHOG_PROJECT_TOKEN: "phc_test_token",
          POSTHOG_HOST: "https://eu.i.posthog.com",
        }),
      );

      const response = await app.inject({ method: "GET", url: "/" });

      expect(response.body).toContain("https://eu.i.posthog.com");
      await app.close();
    });

    it("should not load PostHog when no project token is configured", async () => {
      const app = await buildServer(testConfig());

      const response = await app.inject({ method: "GET", url: "/" });

      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("posthog.init");
      await app.close();
    });

    it("should not load PostHog on a self-hosted install", async () => {
      // A customer's own install must never report their visitors to our
      // project, whatever token happens to be sitting in their environment.
      const selfHosted = loadConfig(
        {
          PUBLIC_URL: "http://localhost:3050",
          MONGODB_URI: "mongodb://localhost:27017",
          COOKIE_SECRET_SIGNATURE: "test-secret",
          ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
          POSTHOG_PROJECT_TOKEN: "phc_test_token",
        } as NodeJS.ProcessEnv,
        { distribution: "self-hosted", issuerPublicKey: "pk" },
      );

      const app = await buildServer(selfHosted);

      const response = await app.inject({ method: "GET", url: "/" });

      expect(response.body).not.toContain("posthog.init");
      await app.close();
    });
  });

  describe("configuration source", () => {
    it("should take settings from the injected config rather than the ambient environment", async () => {
      // The whole point of the config module: what the server does is decided
      // by the config it was handed, not by whatever happens to be in
      // process.env at the time.
      const previous = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_SECRET_KEY = "sk_test_from_the_environment";

      try {
        const app = await buildServer(testConfig());

        const response = await app.inject({
          method: "POST",
          url: "/api/billing/checkout",
        });

        expect(response.statusCode).toBe(404);
        await app.close();
      } finally {
        if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
        else process.env.STRIPE_SECRET_KEY = previous;
      }
    });
  });
});
