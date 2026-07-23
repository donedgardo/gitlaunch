import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { FlagRepository } from "../../repositories/flagRepository";
import { FlagConfigVersionRepository } from "../../repositories/flagConfigVersionRepository";
import { FlagConfigVersionService } from "./flagConfigVersionService";

describe("FlagConfigVersionService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let serviceRepo: ServiceRepository;
  let flagRepo: FlagRepository;
  let versionRepo: FlagConfigVersionRepository;
  let versions: FlagConfigVersionService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    serviceRepo = new ServiceRepository(db);
    flagRepo = new FlagRepository(db);
    versionRepo = new FlagConfigVersionRepository(db);
    versions = new FlagConfigVersionService(flagRepo, versionRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("services").deleteMany({});
    await db.collection("flags").deleteMany({});
    await db.collection("flag_config_versions").deleteMany({});
  });

  let slugCounter = 0;
  async function makeAccountAndService() {
    const slug = `acme-${slugCounter++}`;
    const account = await accountRepo.create({ name: slug, slug });
    const svc = await serviceRepo.create({
      accountId: account._id,
      name: "backend",
    });
    return { accountId: account._id, serviceId: svc._id };
  }

  async function seedFlag(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
    env: string,
    config = { enabled: true, rolloutPercentage: 100, variants: [] },
  ) {
    await flagRepo.create({
      accountId,
      serviceId,
      key,
      description: "",
      environments: { [env]: config },
    });
  }

  describe("publish", () => {
    it("should mint version 1 on the first publish and capture the current config", async () => {
      const { accountId, serviceId } = await makeAccountAndService();
      await seedFlag(accountId, serviceId, "new-checkout", "prod");

      const v = await versions.publish(accountId, serviceId, "prod");

      expect(v.version).toBe(1);
      expect(v.environment).toBe("prod");
      expect(v.bundle.flags).toEqual([
        {
          key: "new-checkout",
          config: { enabled: true, rolloutPercentage: 100, variants: [] },
        },
      ]);
      expect(v.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should not mint a new version when the config is unchanged", async () => {
      const { accountId, serviceId } = await makeAccountAndService();
      await seedFlag(accountId, serviceId, "new-checkout", "prod");

      const first = await versions.publish(accountId, serviceId, "prod");
      const second = await versions.publish(accountId, serviceId, "prod");

      expect(second.version).toBe(first.version);
      const all = await versions.listVersions(accountId, serviceId, "prod");
      expect(all).toHaveLength(1);
    });

    it("should mint the next version when the config changes", async () => {
      const { accountId, serviceId } = await makeAccountAndService();
      await seedFlag(accountId, serviceId, "new-checkout", "prod");
      await versions.publish(accountId, serviceId, "prod");

      await flagRepo.updateEnvConfig(
        accountId,
        serviceId,
        "new-checkout",
        "prod",
        {
          enabled: true,
          rolloutPercentage: 50,
          variants: [],
        },
      );
      const v2 = await versions.publish(accountId, serviceId, "prod");

      expect(v2.version).toBe(2);
      const all = await versions.listVersions(accountId, serviceId, "prod");
      expect(all).toHaveLength(2);
      expect(all[0].version).toBe(2); // newest first
    });

    it("should keep independent version counters per environment", async () => {
      const { accountId, serviceId } = await makeAccountAndService();
      await seedFlag(accountId, serviceId, "new-checkout", "prod");
      await seedFlag(accountId, serviceId, "new-checkout", "staging", {
        enabled: false,
        rolloutPercentage: 0,
        variants: [],
      });

      const prod = await versions.publish(accountId, serviceId, "prod");
      const staging = await versions.publish(accountId, serviceId, "staging");

      expect(prod.version).toBe(1);
      expect(staging.version).toBe(1);
      expect(prod.hash).not.toBe(staging.hash);
    });

    it("should isolate versions between tenants", async () => {
      const a = await makeAccountAndService();
      const b = await makeAccountAndService();
      await seedFlag(a.accountId, a.serviceId, "flag-a", "prod");
      await seedFlag(b.accountId, b.serviceId, "flag-b", "prod");

      await versions.publish(a.accountId, a.serviceId, "prod");
      await versions.publish(a.accountId, a.serviceId, "prod");
      const bVersions = await versions.listVersions(
        b.accountId,
        b.serviceId,
        "prod",
      );

      expect(bVersions).toHaveLength(0);
    });
  });

  describe("getVersion", () => {
    it("should return the immutable bundle for a specific version even after later edits", async () => {
      const { accountId, serviceId } = await makeAccountAndService();
      await seedFlag(accountId, serviceId, "new-checkout", "prod");
      await versions.publish(accountId, serviceId, "prod");

      // Change the live config and publish a new version.
      await flagRepo.updateEnvConfig(
        accountId,
        serviceId,
        "new-checkout",
        "prod",
        {
          enabled: false,
          rolloutPercentage: 0,
          variants: [],
        },
      );
      await versions.publish(accountId, serviceId, "prod");

      const v1 = await versions.getVersion(accountId, serviceId, "prod", 1);
      expect(v1?.bundle.flags[0].config.enabled).toBe(true);
    });

    it("should return null for a version that does not exist", async () => {
      const { accountId, serviceId } = await makeAccountAndService();
      const missing = await versions.getVersion(
        accountId,
        serviceId,
        "prod",
        99,
      );
      expect(missing).toBeNull();
    });
  });
});
