import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { GithubConnectionService } from "./githubConnectionService";

describe("GithubConnectionService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let service: GithubConnectionService;
  let accountId: ObjectId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    service = new GithubConnectionService(accountRepo);
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
    it("should record the GitHub App installation for the account", async () => {
      // When: I connect an installation
      await service.connect({ accountId, installationId: 12345 });

      // Then: the account reports as connected
      expect(await service.isConnected(accountId)).toBe(true);
    });

    it("should throw when the account does not exist", async () => {
      // Given: a non-existent account
      const fakeAccountId = new ObjectId();

      // When/Then: connecting throws
      await expect(
        service.connect({ accountId: fakeAccountId, installationId: 12345 }),
      ).rejects.toThrow("Account not found");
    });
  });

  describe("isConnected", () => {
    it("should return false for a fresh account", async () => {
      expect(await service.isConnected(accountId)).toBe(false);
    });

    it("should return false for a non-existent account", async () => {
      // A missing account is not connected (guards the undefined != null trap)
      expect(await service.isConnected(new ObjectId())).toBe(false);
    });
  });

  describe("getView", () => {
    it("should return null when not connected", async () => {
      expect(await service.getView(accountId)).toBeNull();
    });

    it("should expose the installation id and connected timestamp", async () => {
      // Given: a connected account
      await service.connect({ accountId, installationId: 777 });

      // When: I read the connection view
      const view = await service.getView(accountId);

      // Then: it carries the installation id and a connected marker
      expect(view?.installationId).toBe(777);
      expect(view?.connected).toBe(true);
      expect(view?.connectedAt).toBeInstanceOf(Date);
    });
  });

  describe("disconnect", () => {
    it("should remove the connection", async () => {
      // Given: a connected account
      await service.connect({ accountId, installationId: 12345 });
      expect(await service.isConnected(accountId)).toBe(true);

      // When: I disconnect
      await service.disconnect(accountId);

      // Then: it is no longer connected
      expect(await service.isConnected(accountId)).toBe(false);
    });
  });
});
