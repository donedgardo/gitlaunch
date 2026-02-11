import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { AccountRepository, Plan } from "./accountRepository";

describe("AccountRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: AccountRepository;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new AccountRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clean up between tests
    await db.collection("accounts").deleteMany({});
  });

  describe("create", () => {
    it("should create account and return it with generated ID and default free plan", async () => {
      // Given: account details
      const input = { name: "My Organization", slug: "my-org" };

      // When: I create the account
      const account = await repo.create(input);

      // Then: I get back an account with the details and a generated ID
      expect(account.name).toBe("My Organization");
      expect(account.slug).toBe("my-org");
      expect(account._id).toBeDefined();
      expect(account.plan).toBe(Plan.Free);
      expect(account.planLimits.maxRepositories).toBe(3);
      expect(account.planLimits.maxServices).toBe(3);
      expect(account.planLimits.maxUsers).toBe(1);
      expect(account.planLimits.publicReposOnly).toBe(true);
    });

    it("should persist the account so it can be retrieved later", async () => {
      // Given: I create an account
      const input = { name: "Persisted Org", slug: "persisted-org" };
      const created = await repo.create(input);

      // When: I look it up by slug
      const found = await repo.findBySlug("persisted-org");

      // Then: I find the same account
      expect(found).not.toBeNull();
      expect(found!._id.toString()).toBe(created._id.toString());
      expect(found!.name).toBe("Persisted Org");
    });
  });

  describe("create with duplicate slug", () => {
    it("should reject duplicate slug with clear error", async () => {
      // Given: an account with slug "taken" exists
      await repo.create({ name: "First Org", slug: "taken" });

      // When: I try to create another account with the same slug
      // Then: it should throw a clear error
      await expect(
        repo.create({ name: "Second Org", slug: "taken" }),
      ).rejects.toThrow("Account with slug 'taken' already exists");
    });
  });

  describe("findBySlug", () => {
    it("should return the account when found by slug", async () => {
      // Given: an account exists
      await repo.create({ name: "Find Me", slug: "find-me" });

      // When: I look it up by slug
      const result = await repo.findBySlug("find-me");

      // Then: I get the account back
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Find Me");
      expect(result!.slug).toBe("find-me");
    });

    it("should return null when account not found", async () => {
      // When: I look up a slug that doesn't exist
      const result = await repo.findBySlug("non-existent");

      // Then: I get null
      expect(result).toBeNull();
    });
  });

  describe("findById", () => {
    it("should return the account when found by ID", async () => {
      // Given: an account exists
      const created = await repo.create({
        name: "Find By ID",
        slug: "find-by-id",
      });

      // When: I look it up by ID
      const result = await repo.findById(created._id);

      // Then: I get the account back
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Find By ID");
      expect(result!._id.toString()).toBe(created._id.toString());
    });
  });

  describe("updateInstallation", () => {
    it("should update account with installation ID", async () => {
      // Given: an account exists
      const created = await repo.create({
        name: "Install Me",
        slug: "install-me",
      });
      expect(created.githubInstallationId).toBeNull();

      // When: I update the installation
      await repo.updateInstallation(created._id, 12345);

      // Then: the account has the installation ID
      const updated = await repo.findById(created._id);
      expect(updated?.githubInstallationId).toBe(12345);
    });
  });

  describe("Plan enum", () => {
    it("should have Free, Pro, and Team values", () => {
      // Then: Plan enum has three tier values
      expect(Plan.Free).toBe("free");
      expect(Plan.Pro).toBe("pro");
      expect(Plan.Team).toBe("team");
    });
  });

  describe("create with updated FREE_PLAN_LIMITS", () => {
    it("should create account with Free plan limits: 3 repos, 3 services, 1 user, public-only", async () => {
      // Given: account details
      const input = { name: "Free Account", slug: "free-acct" };

      // When: I create the account
      const account = await repo.create(input);

      // Then: I get back account with updated Free limits
      expect(account.plan).toBe(Plan.Free);
      expect(account.planLimits.maxRepositories).toBe(3);
      expect(account.planLimits.maxServices).toBe(3);
      expect(account.planLimits.maxUsers).toBe(1);
      expect(account.planLimits.publicReposOnly).toBe(true);
    });
  });

  describe("upgradeToPlan", () => {
    it("should upgrade account to Pro with correct limits", async () => {
      // Given: a Free account exists
      const created = await repo.create({
        name: "Upgrade Me",
        slug: "upgrade-me",
      });
      expect(created.plan).toBe(Plan.Free);

      // When: I upgrade to Pro
      await repo.upgradeToPlan(created._id, "cus_123", "sub_456", Plan.Pro);

      // Then: the account has Pro plan with correct limits
      const upgraded = await repo.findById(created._id);
      expect(upgraded?.plan).toBe(Plan.Pro);
      expect(upgraded?.planLimits.maxRepositories).toBe(10);
      expect(upgraded?.planLimits.maxServices).toBe(10);
      expect(upgraded?.planLimits.maxUsers).toBe(5);
      expect(upgraded?.planLimits.publicReposOnly).toBe(false);
      expect(upgraded?.stripeCustomerId).toBe("cus_123");
      expect(upgraded?.stripeSubscriptionId).toBe("sub_456");
    });

    it("should upgrade account to Team with correct limits", async () => {
      // Given: a Free account exists
      const created = await repo.create({ name: "Team Org", slug: "team-org" });
      expect(created.plan).toBe(Plan.Free);

      // When: I upgrade to Team
      await repo.upgradeToPlan(created._id, "cus_789", "sub_abc", Plan.Team);

      // Then: the account has Team plan with correct limits
      const upgraded = await repo.findById(created._id);
      expect(upgraded?.plan).toBe(Plan.Team);
      expect(upgraded?.planLimits.maxRepositories).toBe(999);
      expect(upgraded?.planLimits.maxServices).toBe(999);
      expect(upgraded?.planLimits.maxUsers).toBe(999);
      expect(upgraded?.planLimits.publicReposOnly).toBe(false);
      expect(upgraded?.stripeCustomerId).toBe("cus_789");
      expect(upgraded?.stripeSubscriptionId).toBe("sub_abc");
    });

    it("should throw error when trying to upgrade to Free plan", async () => {
      // Given: a Free account exists
      const created = await repo.create({
        name: "No Downgrade",
        slug: "no-downgrade",
      });

      // When: I try to "upgrade" to Free
      // Then: it should throw an error
      await expect(
        repo.upgradeToPlan(created._id, "cus_123", "sub_456", Plan.Free),
      ).rejects.toThrow("Cannot upgrade to Free plan");
    });
  });

  describe("selectPlan", () => {
    it("should set plan to Pro with correct limits without touching Stripe IDs", async () => {
      // Given: a Free account exists with no Stripe IDs
      const created = await repo.create({
        name: "Select Pro",
        slug: "select-pro",
      });
      expect(created.stripeCustomerId).toBeNull();
      expect(created.stripeSubscriptionId).toBeNull();

      // When: I select Pro plan
      await repo.selectPlan(created._id, Plan.Pro);

      // Then: the account has Pro plan and limits but no Stripe IDs
      const updated = await repo.findById(created._id);
      expect(updated?.plan).toBe(Plan.Pro);
      expect(updated?.planLimits.maxRepositories).toBe(10);
      expect(updated?.planLimits.maxServices).toBe(10);
      expect(updated?.planLimits.maxUsers).toBe(5);
      expect(updated?.planLimits.publicReposOnly).toBe(false);
      expect(updated?.stripeCustomerId).toBeNull();
      expect(updated?.stripeSubscriptionId).toBeNull();
    });

    it("should set plan to Team with correct limits without touching Stripe IDs", async () => {
      // Given: a Free account exists
      const created = await repo.create({
        name: "Select Team",
        slug: "select-team",
      });

      // When: I select Team plan
      await repo.selectPlan(created._id, Plan.Team);

      // Then: the account has Team plan and limits but no Stripe IDs
      const updated = await repo.findById(created._id);
      expect(updated?.plan).toBe(Plan.Team);
      expect(updated?.planLimits.maxRepositories).toBe(999);
      expect(updated?.planLimits.maxServices).toBe(999);
      expect(updated?.planLimits.maxUsers).toBe(999);
      expect(updated?.planLimits.publicReposOnly).toBe(false);
      expect(updated?.stripeCustomerId).toBeNull();
      expect(updated?.stripeSubscriptionId).toBeNull();
    });

    it("should set plan to Free with correct limits without touching Stripe IDs", async () => {
      // Given: a Free account exists
      const created = await repo.create({
        name: "Select Free",
        slug: "select-free",
      });

      // When: I select Free plan explicitly
      await repo.selectPlan(created._id, Plan.Free);

      // Then: the account has Free plan and limits but no Stripe IDs
      const updated = await repo.findById(created._id);
      expect(updated?.plan).toBe(Plan.Free);
      expect(updated?.planLimits.maxRepositories).toBe(3);
      expect(updated?.planLimits.maxServices).toBe(3);
      expect(updated?.planLimits.maxUsers).toBe(1);
      expect(updated?.planLimits.publicReposOnly).toBe(true);
      expect(updated?.stripeCustomerId).toBeNull();
      expect(updated?.stripeSubscriptionId).toBeNull();
    });

    it("should not modify Stripe IDs even if they exist", async () => {
      // Given: an account with existing Stripe IDs
      const created = await repo.create({
        name: "Has Stripe",
        slug: "has-stripe",
      });
      await repo.upgradeToPlan(
        created._id,
        "cus_existing",
        "sub_existing",
        Plan.Pro,
      );

      // When: I select a different plan using selectPlan
      await repo.selectPlan(created._id, Plan.Team);

      // Then: Stripe IDs remain unchanged
      const updated = await repo.findById(created._id);
      expect(updated?.plan).toBe(Plan.Team);
      expect(updated?.stripeCustomerId).toBe("cus_existing");
      expect(updated?.stripeSubscriptionId).toBe("sub_existing");
    });
  });
});
