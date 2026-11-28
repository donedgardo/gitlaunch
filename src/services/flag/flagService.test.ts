import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { FlagRepository } from "../../repositories/flagRepository";
import { FlagConfigVersionRepository } from "../../repositories/flagConfigVersionRepository";
import { FlagConfigVersionService } from "./flagConfigVersionService";
import { FlagService } from "./flagService";
import { FlagChangeRepository } from "../../repositories/flagChangeRepository";
import { Actor, Attribution } from "../service/actor";

// Who is making the change in tests that are not about attribution.
const TEST_BY: Attribution = {
  actor: {
    kind: "apiKey",
    apiKeyId: new ObjectId(),
    name: "test-key",
    via: "api",
  },
};

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

      const flag = await service.createFlag(
        account._id,
        svc._id,
        {
          key: "new-checkout",
          description: "New checkout flow",
        },
        TEST_BY,
      );

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
        service.createFlag(
          account._id,
          svc._id,
          {
            key: "Not A Slug",
            description: "",
          },
          TEST_BY,
        ),
      ).rejects.toThrow();
    });

    it("should reject a duplicate flag key", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "dupe",
          description: "",
        },
        TEST_BY,
      );

      await expect(
        service.createFlag(
          account._id,
          svc._id,
          {
            key: "dupe",
            description: "",
          },
          TEST_BY,
        ),
      ).rejects.toThrow();
    });

    it("should reject when the service does not belong to the account", async () => {
      const { svc } = await makeAccountAndService("acme");
      const otherAccountId = new ObjectId();

      await expect(
        service.createFlag(
          otherAccountId,
          svc._id,
          {
            key: "x",
            description: "",
          },
          TEST_BY,
        ),
      ).rejects.toThrow();
    });
  });

  describe("tenant isolation", () => {
    it("should not list another account's flags", async () => {
      const a = await makeAccountAndService("acme");
      const b = await makeAccountAndService("other");
      await service.createFlag(
        a.account._id,
        a.svc._id,
        {
          key: "secret",
          description: "",
        },
        TEST_BY,
      );

      const flags = await service.listFlags(b.account._id, b.svc._id);
      expect(flags).toHaveLength(0);
    });
  });

  describe("setEnvConfig", () => {
    it("should enable a flag and set a rollout percentage for one environment", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "beta",
          description: "",
        },
        TEST_BY,
      );

      const updated = await service.setEnvConfig(
        account._id,
        svc._id,
        "beta",
        "staging",
        { enabled: true, rolloutPercentage: 25 },
        TEST_BY,
      );

      expect(updated.environments.staging.enabled).toBe(true);
      expect(updated.environments.staging.rolloutPercentage).toBe(25);
      // prod untouched
      expect(updated.environments.prod.enabled).toBe(false);
    });

    it("should reject an unknown environment", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "beta",
          description: "",
        },
        TEST_BY,
      );

      await expect(
        service.setEnvConfig(
          account._id,
          svc._id,
          "beta",
          "does-not-exist",
          {
            enabled: true,
          },
          TEST_BY,
        ),
      ).rejects.toThrow();
    });

    it("should reject a rollout percentage outside 0..100", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "beta",
          description: "",
        },
        TEST_BY,
      );

      await expect(
        service.setEnvConfig(
          account._id,
          svc._id,
          "beta",
          "staging",
          {
            rolloutPercentage: 150,
          },
          TEST_BY,
        ),
      ).rejects.toThrow();
    });

    it("should reject variant weights that do not sum to 100", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "exp",
          description: "",
        },
        TEST_BY,
      );

      await expect(
        service.setEnvConfig(
          account._id,
          svc._id,
          "exp",
          "staging",
          {
            enabled: true,
            variants: [
              { key: "a", weight: 40 },
              { key: "b", weight: 40 },
            ],
          },
          TEST_BY,
        ),
      ).rejects.toThrow();
    });

    it("should accept valid variants summing to 100", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "exp",
          description: "",
        },
        TEST_BY,
      );

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
        TEST_BY,
      );

      expect(updated.environments.staging.variants).toHaveLength(2);
    });

    it("should persist valid targeting rules", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "beta",
          description: "",
        },
        TEST_BY,
      );

      const updated = await service.setEnvConfig(
        account._id,
        svc._id,
        "beta",
        "staging",
        {
          enabled: true,
          targetingRules: [
            {
              conditions: [
                { attribute: "country", operator: "in", values: ["US", "CA"] },
              ],
              serve: null,
            },
          ],
        },
        TEST_BY,
      );

      expect(updated.environments.staging.targetingRules).toHaveLength(1);
      expect(
        updated.environments.staging.targetingRules![0].conditions[0].attribute,
      ).toBe("country");
    });

    it("should reject a rule with an empty attribute name", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "beta",
          description: "",
        },
        TEST_BY,
      );

      await expect(
        service.setEnvConfig(
          account._id,
          svc._id,
          "beta",
          "staging",
          {
            targetingRules: [
              {
                conditions: [{ attribute: "", operator: "eq", values: ["US"] }],
                serve: null,
              },
            ],
          },
          TEST_BY,
        ),
      ).rejects.toThrow();
    });

    it("should reject a rule with no conditions", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "beta",
          description: "",
        },
        TEST_BY,
      );

      await expect(
        service.setEnvConfig(
          account._id,
          svc._id,
          "beta",
          "staging",
          {
            targetingRules: [{ conditions: [], serve: null }],
          },
          TEST_BY,
        ),
      ).rejects.toThrow();
    });

    it("should reject a condition with an unknown operator", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "beta",
          description: "",
        },
        TEST_BY,
      );

      await expect(
        service.setEnvConfig(
          account._id,
          svc._id,
          "beta",
          "staging",
          {
            targetingRules: [
              {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                conditions: [
                  {
                    attribute: "country",
                    operator: "wat" as any,
                    values: ["US"],
                  },
                ],
                serve: null,
              },
            ],
          },
          TEST_BY,
        ),
      ).rejects.toThrow();
    });

    it("should reject a rule that serves an undefined variant", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "beta",
          description: "",
        },
        TEST_BY,
      );

      await expect(
        service.setEnvConfig(
          account._id,
          svc._id,
          "beta",
          "staging",
          {
            enabled: true,
            variants: [
              { key: "control", weight: 50 },
              { key: "treatment", weight: 50 },
            ],
            targetingRules: [
              {
                conditions: [
                  { attribute: "plan", operator: "eq", values: ["pro"] },
                ],
                serve: "does-not-exist",
              },
            ],
          },
          TEST_BY,
        ),
      ).rejects.toThrow();
    });
  });

  describe("evaluate", () => {
    it("should serve a targeting rule based on entity attributes", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "beta",
          description: "",
        },
        TEST_BY,
      );
      await service.setEnvConfig(
        account._id,
        svc._id,
        "beta",
        "prod",
        {
          enabled: true,
          rolloutPercentage: 0,
          targetingRules: [
            {
              conditions: [
                { attribute: "plan", operator: "eq", values: ["enterprise"] },
              ],
              serve: null,
            },
          ],
        },
        TEST_BY,
      );

      const matched = await service.evaluate(
        account._id,
        svc._id,
        "prod",
        "user-1",
        {
          plan: "enterprise",
        },
      );
      expect(matched.find((r) => r.key === "beta")!.reason).toBe(
        "targeting_rule",
      );

      const unmatched = await service.evaluate(
        account._id,
        svc._id,
        "prod",
        "user-1",
        {
          plan: "free",
        },
      );
      expect(unmatched.find((r) => r.key === "beta")!.enabled).toBe(false);
    });
  });

  describe("evaluateOne with attributes", () => {
    it("should attribute a conversion to the targeting-rule variant", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "exp",
          description: "",
        },
        TEST_BY,
      );
      await service.setEnvConfig(
        account._id,
        svc._id,
        "exp",
        "prod",
        {
          enabled: true,
          rolloutPercentage: 0,
          variants: [
            { key: "control", weight: 50 },
            { key: "treatment", weight: 50 },
          ],
          targetingRules: [
            {
              conditions: [
                { attribute: "country", operator: "eq", values: ["US"] },
              ],
              serve: "treatment",
            },
          ],
        },
        TEST_BY,
      );

      const one = await service.evaluateOne(
        account._id,
        svc._id,
        "prod",
        "exp",
        "user-1",
        { country: "US" },
      );
      expect(one!.variant).toBe("treatment");
      expect(one!.reason).toBe("targeting_rule");
    });
  });

  describe("evaluate", () => {
    it("should evaluate all flags for an environment and entity", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "on-flag",
          description: "",
        },
        TEST_BY,
      );
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "off-flag",
          description: "",
        },
        TEST_BY,
      );
      await service.setEnvConfig(
        account._id,
        svc._id,
        "on-flag",
        "prod",
        {
          enabled: true,
          rolloutPercentage: 100,
        },
        TEST_BY,
      );

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

  describe("evaluateOne", () => {
    it("should return the same variant as evaluate for a single flag", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "exp",
          description: "",
        },
        TEST_BY,
      );
      await service.setEnvConfig(
        account._id,
        svc._id,
        "exp",
        "prod",
        {
          enabled: true,
          rolloutPercentage: 100,
          variants: [
            { key: "control", weight: 50 },
            { key: "treatment", weight: 50 },
          ],
        },
        TEST_BY,
      );

      const all = await service.evaluate(
        account._id,
        svc._id,
        "prod",
        "user-42",
      );
      const one = await service.evaluateOne(
        account._id,
        svc._id,
        "prod",
        "exp",
        "user-42",
      );

      expect(one).not.toBeNull();
      expect(one!.enabled).toBe(true);
      expect(one!.variant).toBe(all.find((e) => e.key === "exp")!.variant);
    });

    it("should return null when the flag does not exist", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      const one = await service.evaluateOne(
        account._id,
        svc._id,
        "prod",
        "missing",
        "user-1",
      );
      expect(one).toBeNull();
    });
  });

  describe("caching", () => {
    it("should serve evaluation from cache and reflect writes made through the service", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "cached",
          description: "",
        },
        TEST_BY,
      );

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
      await service.setEnvConfig(
        account._id,
        svc._id,
        "cached",
        "prod",
        {
          enabled: true,
          rolloutPercentage: 100,
        },
        TEST_BY,
      );
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
      await service.createFlag(
        account._id,
        svc._id,
        {
          key: "temp",
          description: "",
        },
        TEST_BY,
      );

      const deleted = await service.deleteFlag(
        account._id,
        svc._id,
        "temp",
        TEST_BY,
      );
      expect(deleted).toBe(true);
      expect(await service.getFlag(account._id, svc._id, "temp")).toBeNull();
    });
  });

  describe("config version auto-publish", () => {
    let versionRepo: FlagConfigVersionRepository;
    let versionService: FlagConfigVersionService;
    let versioned: FlagService;

    beforeEach(async () => {
      await db.collection("flag_config_versions").deleteMany({});
      versionRepo = new FlagConfigVersionRepository(db);
      versionService = new FlagConfigVersionService(flagRepo, versionRepo);
      versioned = new FlagService(
        flagRepo,
        serviceRepo,
        undefined,
        versionService,
      );
    });

    it("should publish an initial config version for each environment when a flag is created", async () => {
      const { account, svc } = await makeAccountAndService("acme");

      await versioned.createFlag(
        account._id,
        svc._id,
        {
          key: "new-checkout",
          description: "",
        },
        TEST_BY,
      );

      const prod = await versionService.listVersions(
        account._id,
        svc._id,
        "prod",
      );
      const staging = await versionService.listVersions(
        account._id,
        svc._id,
        "staging",
      );
      expect(prod).toHaveLength(1);
      expect(staging).toHaveLength(1);
    });

    it("should publish a new version for the changed environment only", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await versioned.createFlag(
        account._id,
        svc._id,
        {
          key: "new-checkout",
          description: "",
        },
        TEST_BY,
      );

      await versioned.setEnvConfig(
        account._id,
        svc._id,
        "new-checkout",
        "prod",
        {
          enabled: true,
          rolloutPercentage: 100,
        },
        TEST_BY,
      );

      const prod = await versionService.listVersions(
        account._id,
        svc._id,
        "prod",
      );
      const staging = await versionService.listVersions(
        account._id,
        svc._id,
        "staging",
      );
      expect(prod).toHaveLength(2); // create + change
      expect(prod[0].bundle.flags[0].config.enabled).toBe(true);
      expect(staging).toHaveLength(1); // unchanged
    });

    it("should publish a new version when a flag is deleted", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      await versioned.createFlag(
        account._id,
        svc._id,
        {
          key: "temp",
          description: "",
        },
        TEST_BY,
      );

      await versioned.deleteFlag(account._id, svc._id, "temp", TEST_BY);

      const prod = await versionService.listVersions(
        account._id,
        svc._id,
        "prod",
      );
      expect(prod).toHaveLength(2); // create + delete
      expect(prod[0].bundle.flags).toHaveLength(0); // empty after delete
    });

    it("should not break flag writes when versioning has no publisher", async () => {
      const { account, svc } = await makeAccountAndService("acme");
      // `service` (the shared instance) has no version publisher configured.
      const flag = await service.createFlag(
        account._id,
        svc._id,
        {
          key: "no-versioning",
          description: "",
        },
        TEST_BY,
      );
      expect(flag.key).toBe("no-versioning");
    });
  });

  describe("attribution", () => {
    const maria: Actor = {
      kind: "user",
      userId: new ObjectId(),
      name: "Maria",
      via: "dashboard",
    };
    const agent: Actor = {
      kind: "apiKey",
      apiKeyId: new ObjectId(),
      name: "staging-agent",
      via: "mcp",
    };
    let changes: FlagChangeRepository;
    let attributed: FlagService;

    beforeEach(async () => {
      await db.collection("flagChanges").deleteMany({});
      changes = new FlagChangeRepository(db);
      attributed = new FlagService(
        flagRepo,
        serviceRepo,
        undefined,
        undefined,
        changes,
      );
    });

    it("should record who created a flag", async () => {
      const { account, svc } = await makeAccountAndService("who-created");

      await attributed.createFlag(
        account._id,
        svc._id,
        { key: "beta", description: "" },
        { actor: maria },
      );

      const [change] = await changes.listByService(account._id, svc._id);
      expect(change).toMatchObject({
        flagKey: "beta",
        change: "created",
        actor: maria,
      });
      expect(change).not.toHaveProperty("environment");
    });

    it("should record who switched a flag, in which environment, and what it was before and after", async () => {
      const { account, svc } = await makeAccountAndService("who-switched");
      await attributed.createFlag(
        account._id,
        svc._id,
        { key: "beta", description: "" },
        { actor: maria },
      );

      await attributed.setEnvConfig(
        account._id,
        svc._id,
        "beta",
        "prod",
        { enabled: true, rolloutPercentage: 25 },
        { actor: agent, reason: "start the rollout" },
      );

      const [change] = await changes.listByService(account._id, svc._id);
      expect(change).toMatchObject({
        flagKey: "beta",
        change: "configured",
        environment: "prod",
        actor: agent,
        reason: "start the rollout",
      });
      expect(change.before).toMatchObject({
        enabled: false,
        rolloutPercentage: 0,
      });
      expect(change.after).toMatchObject({
        enabled: true,
        rolloutPercentage: 25,
      });
    });

    it("should record who deleted a flag", async () => {
      const { account, svc } = await makeAccountAndService("who-deleted");
      await attributed.createFlag(
        account._id,
        svc._id,
        { key: "beta", description: "" },
        { actor: maria },
      );

      await attributed.deleteFlag(account._id, svc._id, "beta", {
        actor: agent,
      });

      const [change] = await changes.listByService(account._id, svc._id);
      expect(change).toMatchObject({
        flagKey: "beta",
        change: "deleted",
        actor: agent,
      });
    });

    it("should record nothing for a change that was refused", async () => {
      const { account, svc } = await makeAccountAndService("refused");
      await attributed.createFlag(
        account._id,
        svc._id,
        { key: "beta", description: "" },
        { actor: maria },
      );

      await expect(
        attributed.setEnvConfig(
          account._id,
          svc._id,
          "beta",
          "prod",
          { rolloutPercentage: 150 },
          { actor: agent },
        ),
      ).rejects.toThrow();

      const all = await changes.listByService(account._id, svc._id);
      expect(all.map((c) => c.change)).toEqual(["created"]);
    });

    it("should record nothing when asked to delete a flag that does not exist", async () => {
      const { account, svc } = await makeAccountAndService("nothing-there");

      await attributed.deleteFlag(account._id, svc._id, "ghost", {
        actor: agent,
      });

      expect(await changes.listByService(account._id, svc._id)).toEqual([]);
    });
  });
});
