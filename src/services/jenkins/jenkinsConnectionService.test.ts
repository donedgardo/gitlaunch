import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
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

  describe("reEncryptStoredToken (key rotation)", () => {
    const KEY_A = Buffer.alloc(32, 1).toString("base64");
    const KEY_B = Buffer.alloc(32, 2).toString("base64");
    const saved = {
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
      ENCRYPTION_KEYS: process.env.ENCRYPTION_KEYS,
      ENCRYPTION_PRIMARY_KEY_ID: process.env.ENCRYPTION_PRIMARY_KEY_ID,
    };

    function setKeyring(entries: Record<string, string>, primaryId: string) {
      delete process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEYS = Object.entries(entries)
        .map(([id, key]) => `${id}:${key}`)
        .join(",");
      process.env.ENCRYPTION_PRIMARY_KEY_ID = primaryId;
    }

    afterEach(() => {
      delete process.env.ENCRYPTION_KEYS;
      delete process.env.ENCRYPTION_PRIMARY_KEY_ID;
      delete process.env.ENCRYPTION_KEY;
      if (saved.ENCRYPTION_KEY !== undefined)
        process.env.ENCRYPTION_KEY = saved.ENCRYPTION_KEY;
      if (saved.ENCRYPTION_KEYS !== undefined)
        process.env.ENCRYPTION_KEYS = saved.ENCRYPTION_KEYS;
      if (saved.ENCRYPTION_PRIMARY_KEY_ID !== undefined)
        process.env.ENCRYPTION_PRIMARY_KEY_ID = saved.ENCRYPTION_PRIMARY_KEY_ID;
    });

    it("should re-encrypt a stored token so it survives dropping the old key", async () => {
      // Given: a token stored under k1
      setKeyring({ k1: KEY_A }, "k1");
      await service.connect({
        accountId,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: "rotate-me",
      });

      // When: we rotate to k2 (k1 retained) and re-encrypt the stored token
      setKeyring({ k1: KEY_A, k2: KEY_B }, "k2");
      const changed = await service.reEncryptStoredToken(accountId);
      expect(changed).toBe(true);

      // Then: the token still decrypts even after k1 is removed
      setKeyring({ k2: KEY_B }, "k2");
      expect(await service.getDecryptedToken(accountId)).toBe("rotate-me");
    });

    it("should be a no-op when the token already uses the primary key", async () => {
      setKeyring({ k1: KEY_A }, "k1");
      await service.connect({
        accountId,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: "fresh",
      });

      expect(await service.reEncryptStoredToken(accountId)).toBe(false);
    });

    it("should return false when there is no connection", async () => {
      setKeyring({ k1: KEY_A }, "k1");
      expect(await service.reEncryptStoredToken(accountId)).toBe(false);
    });
  });
});
