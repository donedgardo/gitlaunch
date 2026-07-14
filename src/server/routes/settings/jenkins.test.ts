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
import { JenkinsConnectionService } from "../../../services/jenkins/jenkinsConnectionService";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerJenkinsSettingsRoutes } from "./jenkins";

describe("Jenkins Settings Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let jenkinsService: JenkinsConnectionService;
  let sessionService: SessionService;

  const TEST_SECRET = "test-secret-for-sessions";
  const COOKIE_SECRET = "test-cookie-secret";
  const SECRET_TOKEN = "jenkins-secret-token-xyz";

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
    jenkinsService = new JenkinsConnectionService(accountRepo);
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
    registerJenkinsSettingsRoutes(app, {
      jenkinsConnectionService: jenkinsService,
    });
    await app.ready();
  });

  describe("GET /settings/jenkins", () => {
    it("should redirect unauthenticated users", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/settings/jenkins",
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/auth/github");
    });

    it("should show the connect form when not connected", async () => {
      const account = await accountRepo.create({ name: "Acme", slug: "acme" });
      const response = await app.inject({
        method: "GET",
        url: "/settings/jenkins",
        cookies: { session: await authFor(account._id) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body.toLowerCase()).toContain("jenkins");
    });

    it("should show connected details but never the token", async () => {
      const account = await accountRepo.create({ name: "Acme", slug: "acme" });
      await jenkinsService.connect({
        accountId: account._id,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: SECRET_TOKEN,
      });

      const response = await app.inject({
        method: "GET",
        url: "/settings/jenkins",
        cookies: { session: await authFor(account._id) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("https://ci.acme.com");
      expect(response.body).toContain("deploy-bot");
      expect(response.body).not.toContain(SECRET_TOKEN);
    });
  });

  describe("POST /settings/jenkins", () => {
    it("should save a connection and never echo the token", async () => {
      const account = await accountRepo.create({ name: "Acme", slug: "acme" });

      const response = await app.inject({
        method: "POST",
        url: "/settings/jenkins",
        cookies: { session: await authFor(account._id) },
        payload: {
          baseUrl: "https://ci.acme.com",
          username: "deploy-bot",
          apiToken: SECRET_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(SECRET_TOKEN);

      // And the token is stored encrypted, not in plaintext
      const stored = await accountRepo.findById(account._id);
      expect(stored?.jenkinsConnection?.apiTokenEncrypted).toBeDefined();
      expect(stored?.jenkinsConnection?.apiTokenEncrypted).not.toContain(
        SECRET_TOKEN,
      );
    });
  });

  describe("DELETE /settings/jenkins", () => {
    it("should remove the connection", async () => {
      const account = await accountRepo.create({ name: "Acme", slug: "acme" });
      await jenkinsService.connect({
        accountId: account._id,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: SECRET_TOKEN,
      });

      const response = await app.inject({
        method: "DELETE",
        url: "/settings/jenkins",
        cookies: { session: await authFor(account._id) },
      });

      expect(response.statusCode).toBe(200);
      expect(await jenkinsService.getView(account._id)).toBeNull();
    });
  });
});
