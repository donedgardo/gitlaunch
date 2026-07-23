import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { FlagRepository } from "../../repositories/flagRepository";
import { FlagService } from "./flagService";

describe("FlagService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let serviceRepo: ServiceRepository;
  let flagRepo: FlagRepository;
  let service: FlagService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    serviceRepo = new ServiceRepository(db);
    flagRepo = new FlagRepository(db);
    service = new FlagService(flagRepo, serviceRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("services").deleteMany({});
    await db.collection("flags").deleteMany({});
  });

  async function makeAccountAndService(slug: string) {
    const account = await accountRepo.create({ name: slug, slug });
    const svc = await serviceRepo.create({
      accountId: account._id,
      name: "backend",
    });
    return { account, svc };
  }

  describe("createFlag", () => {
    it("should seed every service environment as off when created", async () => {
      const { account, svc } = await makeAccountAndService("acme");

      const flag = await service.createFlag(account._id, svc._id, {
        key: "new-checkout",
        description: "New checkout flow",
      });

      // Service defaults to staging + prod
      expect(Object.keys(flag.environments).sort()).toEqual([
        "prod",
        "staging",
      ]);
      for (const env of Object.values(flag.environments)) {
        expect(env.enabled).toBe(false);
        expect(env.rolloutPercentage).toBe(0);
        expect(env.variants).toEqual([]);
      }
    });

    it("should reject an invalid flag key", async () => {
      const { account, svc } = await makeAccountAndService("acme");

      await expect(
        service.createFlag(account._id, svc._id, {
          key: "Not A Slug",
          description: "",
        }),
      ).rejects.toThrow();
    });

    it("should reject a duplicate flag key", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(account._id, svc._id, {
        key: "dupe",
        description: "",
      });

      await expect(
        service.createFlag(account._id, svc._id, {
          key: "dupe",
          description: "",
        }),
      ).rejects.toThrow();
    });

    it("should reject when the service does not belong to the account", async () => {
      const { svc } = await makeAccountAndService("acme");
      const otherAccountId = new ObjectId();

      await expect(
        service.createFlag(otherAccountId, svc._id, {
          key: "x",
          description: "",
        }),
      ).rejects.toThrow();
    });
  });

  describe("tenant isolation", () => {
    it("should not list another account's flags", async () => {
      const a = await makeAccountAndService("acme");
      const b = await makeAccountAndService("other");
      await service.createFlag(a.account._id, a.svc._id, {
        key: "secret",
        description: "",
      });

      const flags = await service.listFlags(b.account._id, b.svc._id);
      expect(flags).toHaveLength(0);
    });
  });

  describe("setEnvConfig", () => {
    it("should enable a flag and set a rollout percentage for one environment", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(account._id, svc._id, {
        key: "beta",
        description: "",
      });

      const updated = await service.setEnvConfig(
        account._id,
        svc._id,
        "beta",
        "staging",
        { enabled: true, rolloutPercentage: 25 },
      );

      expect(updated.environments.staging.enabled).toBe(true);
      expect(updated.environments.staging.rolloutPercentage).toBe(25);
      // prod untouched
      expect(updated.environments.prod.enabled).toBe(false);
    });

    it("should reject an unknown environment", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(account._id, svc._id, {
        key: "beta",
        description: "",
      });

      await expect(
        service.setEnvConfig(account._id, svc._id, "beta", "does-not-exist", {
          enabled: true,
        }),
      ).rejects.toThrow();
    });

    it("should reject a rollout percentage outside 0..100", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(account._id, svc._id, {
        key: "beta",
        description: "",
      });

      await expect(
        service.setEnvConfig(account._id, svc._id, "beta", "staging", {
          rolloutPercentage: 150,
        }),
      ).rejects.toThrow();
    });

    it("should reject variant weights that do not sum to 100", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(account._id, svc._id, {
        key: "exp",
        description: "",
      });

      await expect(
        service.setEnvConfig(account._id, svc._id, "exp", "staging", {
          enabled: true,
          variants: [
            { key: "a", weight: 40 },
            { key: "b", weight: 40 },
          ],
        }),
      ).rejects.toThrow();
    });

    it("should accept valid variants summing to 100", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(account._id, svc._id, {
        key: "exp",
        description: "",
      });

      const updated = await service.setEnvConfig(
        account._id,
        svc._id,
        "exp",
        "staging",
        {
          enabled: true,
          rolloutPercentage: 100,
          variants: [
            { key: "control", weight: 50 },
            { key: "treatment", weight: 50 },
          ],
        },
      );

      expect(updated.environments.staging.variants).toHaveLength(2);
    });
  });

  describe("evaluate", () => {
    it("should evaluate all flags for an environment and entity", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(account._id, svc._id, {
        key: "on-flag",
        description: "",
      });
      await service.createFlag(account._id, svc._id, {
        key: "off-flag",
        description: "",
      });
      await service.setEnvConfig(account._id, svc._id, "on-flag", "prod", {
        enabled: true,
        rolloutPercentage: 100,
      });

      const results = await service.evaluate(
        account._id,
        svc._id,
        "prod",
        "user-1",
      );

      const byKey = Object.fromEntries(results.map((r) => [r.key, r]));
      expect(byKey["on-flag"].enabled).toBe(true);
      expect(byKey["off-flag"].enabled).toBe(false);
      expect(byKey["off-flag"].reason).toBe("disabled");
    });
  });

  describe("caching", () => {
    it("should serve evaluation from cache and reflect writes made through the service", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(account._id, svc._id, {
        key: "cached",
        description: "",
      });

      // Prime the cache (off everywhere).
      const before = await service.evaluate(
        account._id,
        svc._id,
        "prod",
        "user-1",
      );
      expect(before[0].enabled).toBe(false);

      // A write that bypasses the service must NOT be visible — proves caching.
      await flagRepo.updateEnvConfig(account._id, svc._id, "cached", "prod", {
        enabled: true,
        rolloutPercentage: 100,
        variants: [],
      });
      const stillCached = await service.evaluate(
        account._id,
        svc._id,
        "prod",
        "user-1",
      );
      expect(stillCached[0].enabled).toBe(false);

      // A write through the service invalidates the cache — proves freshness.
      await service.setEnvConfig(account._id, svc._id, "cached", "prod", {
        enabled: true,
        rolloutPercentage: 100,
      });
      const after = await service.evaluate(
        account._id,
        svc._id,
        "prod",
        "user-1",
      );
      expect(after[0].enabled).toBe(true);
    });
  });

  describe("deleteFlag", () => {
    it("should delete a flag", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(account._id, svc._id, {
        key: "temp",
        description: "",
      });

      const deleted = await service.deleteFlag(account._id, svc._id, "temp");
      expect(deleted).toBe(true);
      expect(await service.getFlag(account._id, svc._id, "temp")).toBeNull();
    });
  });
});
