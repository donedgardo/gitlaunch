import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import { AccountRepository } from "../../../repositories/accountRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { registerInstallationRoutes } from "./installation";

describe("GitHub Installation Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let gitHubAppService: GitHubAppService;

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

    app = Fastify();
    registerInstallationRoutes(app, { gitHubAppService });
  });

  describe("GET /github/installation/callback", () => {
    it("should link installation to account and redirect to settings", async () => {
      // Given: an account exists and user is authenticated
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });

      // When: GitHub redirects with installation_id
      const response = await app.inject({
        method: "GET",
        url: `/github/installation/callback?installation_id=98765&setup_action=install`,
        headers: {
          // Simulate authenticated session - in reality this would be a cookie
          "x-account-id": account._id.toString(),
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
      // Given: an account
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-2",
      });

      // When: callback is missing installation_id
      const response = await app.inject({
        method: "GET",
        url: `/github/installation/callback?setup_action=install`,
        headers: {
          "x-account-id": account._id.toString(),
        },
      });

      // Then: returns 400 error
      expect(response.statusCode).toBe(400);
    });

    it("should return 401 if not authenticated", async () => {
      // When: no account ID is provided
      const response = await app.inject({
        method: "GET",
        url: `/github/installation/callback?installation_id=123`,
      });

      // Then: returns 401 error
      expect(response.statusCode).toBe(401);
    });
  });
});
