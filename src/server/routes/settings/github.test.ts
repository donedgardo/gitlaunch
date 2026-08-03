import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { AccountRepository } from "../../../repositories/accountRepository";
import { GithubConnectionService } from "../../../services/github/githubConnectionService";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerGithubSettingsRoutes } from "./github";

describe("GitHub Settings Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let githubService: GithubConnectionService;
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

  async function authFor(accountId: ObjectId): Promise<string> {
    return sessionService.createSession({ userId: new ObjectId(), accountId });
  }

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});

    accountRepo = new AccountRepository(db);
    githubService = new GithubConnectionService(accountRepo);
    sessionService = new SessionService(TEST_SECRET);

    app = Fastify();
    await app.register(cookie, { secret: COOKIE_SECRET });
    await app.register(formbody);
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: {
        compileOptions: { preventIndent: true },
        partials: { navigation: "/partials/navigation.hbs" },
      },
    });
    sessionAuthMiddleware(app, sessionService);
    registerGithubSettingsRoutes(app, {
      github: { useFakes: false, appName: "gitlaunchapp" },
      githubConnectionService: githubService,
    });
    await app.ready();
  });

  describe("GET /settings/github", () => {
    it("should redirect unauthenticated users", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/settings/github",
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/auth/github");
    });

    it("should show the install prompt when not connected", async () => {
      const account = await accountRepo.create({ name: "Acme", slug: "acme" });
      const response = await app.inject({
        method: "GET",
        url: "/settings/github",
        cookies: { session: await authFor(account._id) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Install GitHub App");
    });

    it("should show the installation and a disconnect action when connected", async () => {
      const account = await accountRepo.create({ name: "Acme", slug: "acme" });
      await githubService.connect({
        accountId: account._id,
        installationId: 424242,
      });

      const response = await app.inject({
        method: "GET",
        url: "/settings/github",
        cookies: { session: await authFor(account._id) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("424242");
      expect(response.body).toContain('hx-delete="/settings/github"');
    });
  });

  describe("DELETE /settings/github", () => {
    it("should disconnect the GitHub App", async () => {
      const account = await accountRepo.create({ name: "Acme", slug: "acme" });
      await githubService.connect({
        accountId: account._id,
        installationId: 424242,
      });

      const response = await app.inject({
        method: "DELETE",
        url: "/settings/github",
        cookies: { session: await authFor(account._id) },
      });

      // The page re-renders in its disconnected state...
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Install GitHub App");
      // ...and the connection is gone.
      expect(await githubService.isConnected(account._id)).toBe(false);
    });
  });
});
