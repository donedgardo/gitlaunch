import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { JenkinsConnectionService } from "./jenkinsConnectionService";

describe("JenkinsConnectionService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let service: JenkinsConnectionService;
  let accountId: ObjectId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    service = new JenkinsConnectionService(accountRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    const account = await accountRepo.create({ name: "Acme", slug: "acme" });
    accountId = account._id;
  });

  describe("connect", () => {
    it("should let a user save a Jenkins connection", async () => {
      // When: the user connects Jenkins
      await service.connect({
        accountId,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: "super-secret-token",
      });

      // Then: the connection is visible (without the token)
      const view = await service.getView(accountId);
      expect(view).toEqual({
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        connected: true,
        updatedAt: expect.any(Date),
      });
    });

    it("should encrypt the token at rest (never store plaintext)", async () => {
      // When: the user connects Jenkins
      await service.connect({
        accountId,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: "super-secret-token",
      });

      // Then: the raw stored value is not the plaintext token
      const account = await accountRepo.findById(accountId);
      expect(account?.jenkinsConnection?.apiTokenEncrypted).toBeDefined();
      expect(account?.jenkinsConnection?.apiTokenEncrypted).not.toContain(
        "super-secret-token",
      );
    });
  });

  describe("getView", () => {
    it("should never expose the API token", async () => {
      // Given: a connected account
      await service.connect({
        accountId,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: "super-secret-token",
      });

      // When: the UI reads the connection
      const view = await service.getView(accountId);

      // Then: no field carries the token
      expect(JSON.stringify(view)).not.toContain("super-secret-token");
    });

    it("should return null when no connection exists", async () => {
      expect(await service.getView(accountId)).toBeNull();
    });
  });

  describe("getDecryptedToken", () => {
    it("should recover the original token for internal dispatch use", async () => {
      // Given: a connected account
      await service.connect({
        accountId,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: "super-secret-token",
      });

      // When/Then: the decrypted token round-trips
      expect(await service.getDecryptedToken(accountId)).toBe(
        "super-secret-token",
      );
    });

    it("should return null when no connection exists", async () => {
      expect(await service.getDecryptedToken(accountId)).toBeNull();
    });
  });

  describe("disconnect", () => {
    it("should remove the connection", async () => {
      // Given: a connected account
      await service.connect({
        accountId,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: "super-secret-token",
      });

      // When: the user disconnects
      await service.disconnect(accountId);

      // Then: no connection remains
      expect(await service.getView(accountId)).toBeNull();
    });
  });
});
