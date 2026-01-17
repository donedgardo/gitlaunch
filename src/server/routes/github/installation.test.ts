import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { AccountRepository } from "../../../repositories/accountRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerInstallationRoutes } from "./installation";

describe("GitHub Installation Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let gitHubAppService: GitHubAppService;
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

    accountRepo = new AccountRepository(db);
    gitHubAppService = new GitHubAppService(accountRepo);
    sessionService = new SessionService(TEST_SECRET);

    app = Fastify();
    await app.register(cookie);
    sessionAuthMiddleware(app, sessionService);
    registerInstallationRoutes(app, { gitHubAppService });
    await app.ready();
  });

  describe("GET /github/installation/callback", () => {
    it("should link installation to account and redirect to settings", async () => {
      // Given: an account exists and user is authenticated
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: GitHub redirects with installation_id
      const response = await app.inject({
        method: "GET",
        url: `/github/installation/callback?installation_id=98765&setup_action=install`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: redirects to settings page
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/settings/repositories");

      // And: installation is linked to account
      const updated = await accountRepo.findById(account._id);
      expect(updated?.githubInstallationId).toBe(98765);
    });

    it("should return 400 if installation_id is missing", async () => {
      // Given: an account and authenticated user
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-2",
      });
      const userId = new ObjectId();
      const sessionToken = sessionService.createSession({
        userId,
        accountId: account._id,
      });

      // When: callback is missing installation_id
      const response = await app.inject({
        method: "GET",
        url: `/github/installation/callback?setup_action=install`,
        cookies: {
          session: sessionToken,
        },
      });

      // Then: returns 400 error
      expect(response.statusCode).toBe(400);
    });

    it("should redirect to login if not authenticated", async () => {
      // When: no session is provided
      const response = await app.inject({
        method: "GET",
        url: `/github/installation/callback?installation_id=123`,
      });

      // Then: redirects to GitHub OAuth login
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/auth/github");
    });
  });
});
