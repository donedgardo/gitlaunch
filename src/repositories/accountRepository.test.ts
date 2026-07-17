import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { AccountRepository, Plan, PLAN_LIMITS_MAP } from "./accountRepository";

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

  describe("github connection", () => {
    it("should start with no github connection", async () => {
      // Given/When: a fresh account
      const created = await repo.create({
        name: "Fresh",
        slug: "fresh-acct",
      });

      // Then: it has no github connection
      expect(created.githubConnection).toBeNull();
    });

    it("should record a github connection when an installation is linked", async () => {
      // Given: an account exists
      const created = await repo.create({
        name: "Install Me",
        slug: "install-me",
      });

      // When: I link a GitHub App installation
      await repo.updateInstallation(created._id, 12345);

      // Then: the account carries a github connection value object
      const updated = await repo.findById(created._id);
      expect(updated?.githubConnection?.installationId).toBe(12345);
      expect(updated?.githubConnection?.connectedAt).toBeInstanceOf(Date);
    });

    it("should clear the github connection on disconnect", async () => {
      // Given: a connected account
      const created = await repo.create({ name: "Bye", slug: "bye-acct" });
      await repo.updateInstallation(created._id, 12345);

      // When: I clear the connection
      await repo.clearGithubConnection(created._id);

      // Then: it has no github connection
      const updated = await repo.findById(created._id);
      expect(updated?.githubConnection).toBeNull();
    });

    it("should read a legacy flat installation id as a github connection", async () => {
      // Given: a pre-existing account document with only the legacy flat field
      const now = new Date();
      const { insertedId } = await db.collection("accounts").insertOne({
        name: "Legacy",
        slug: "legacy-acct",
        plan: Plan.Free,
        planLimits: PLAN_LIMITS_MAP[Plan.Free],
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        paymentFailedAt: null,
        trialEndsAt: null,
        githubInstallationId: 98765,
        jenkinsConnection: null,
        createdAt: now,
        updatedAt: now,
      });

      // When: I read it back
      const account = await repo.findById(insertedId);

      // Then: the legacy installation id surfaces as a github connection VO
      expect(account?.githubConnection?.installationId).toBe(98765);
      expect(account?.githubConnection?.connectedAt).toEqual(now);
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

    it("should clear trialEndsAt when upgrading to paid plan", async () => {
      // Given: an account on trial (has trialEndsAt set)
      const created = await repo.create({
        name: "Trial Subscriber",
        slug: "trial-subscriber",
      });
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await repo.setTrialEndsAt(created._id, trialEndsAt);
      await repo.selectPlan(created._id, Plan.Pro);

      // Verify trial is set
      const withTrial = await repo.findById(created._id);
      expect(withTrial?.trialEndsAt).not.toBeNull();

      // When: I upgrade to Pro (user subscribes during trial)
      await repo.upgradeToPlan(created._id, "cus_123", "sub_456", Plan.Pro);

      // Then: trialEndsAt is cleared (no longer on trial, they're subscribed)
      const upgraded = await repo.findById(created._id);
      expect(upgraded?.plan).toBe(Plan.Pro);
      expect(upgraded?.stripeSubscriptionId).toBe("sub_456");
      expect(upgraded?.trialEndsAt).toBeNull();
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

  describe("create with trialEndsAt", () => {
    it("should create account with trialEndsAt set to null by default", async () => {
      // Given: account details
      const input = { name: "Trial Test", slug: "trial-test" };

      // When: I create the account
      const account = await repo.create(input);

      // Then: trialEndsAt is null
      expect(account.trialEndsAt).toBeNull();
    });
  });

  describe("setTrialEndsAt", () => {
    it("should set trialEndsAt to a future date", async () => {
      // Given: an account exists
      const created = await repo.create({
        name: "Trial Account",
        slug: "trial-account",
      });
      expect(created.trialEndsAt).toBeNull();

      // When: I set the trial end date
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await repo.setTrialEndsAt(created._id, trialEndsAt);

      // Then: the account has the trial end date
      const updated = await repo.findById(created._id);
      expect(updated?.trialEndsAt).not.toBeNull();
      expect(updated?.trialEndsAt?.getTime()).toBe(trialEndsAt.getTime());
    });

    it("should set trialEndsAt to null to clear trial", async () => {
      // Given: an account with an active trial
      const created = await repo.create({
        name: "Clear Trial",
        slug: "clear-trial",
      });
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await repo.setTrialEndsAt(created._id, trialEndsAt);

      // When: I clear the trial end date
      await repo.setTrialEndsAt(created._id, null);

      // Then: trialEndsAt is null
      const updated = await repo.findById(created._id);
      expect(updated?.trialEndsAt).toBeNull();
    });
  });

  describe("Jenkins connection", () => {
    it("should default jenkinsConnection to null on create", async () => {
      // When: I create an account
      const account = await repo.create({ name: "No Jenkins", slug: "no-jk" });

      // Then: it has no Jenkins connection
      expect(account.jenkinsConnection).toBeNull();
    });

    it("should store a Jenkins connection and read it back", async () => {
      // Given: an account
      const created = await repo.create({ name: "Jenkins Co", slug: "jk-co" });

      // When: I save a Jenkins connection (token already encrypted)
      await repo.setJenkinsConnection(created._id, {
        baseUrl: "https://ci.example.com",
        username: "deploy-bot",
        apiTokenEncrypted: "v1:iv:tag:cipher",
      });

      // Then: the connection is persisted
      const updated = await repo.findById(created._id);
      expect(updated?.jenkinsConnection?.baseUrl).toBe(
        "https://ci.example.com",
      );
      expect(updated?.jenkinsConnection?.username).toBe("deploy-bot");
      expect(updated?.jenkinsConnection?.apiTokenEncrypted).toBe(
        "v1:iv:tag:cipher",
      );
      expect(updated?.jenkinsConnection?.updatedAt).toBeInstanceOf(Date);
    });

    it("should clear a Jenkins connection", async () => {
      // Given: an account with a Jenkins connection
      const created = await repo.create({ name: "Drop JK", slug: "drop-jk" });
      await repo.setJenkinsConnection(created._id, {
        baseUrl: "https://ci.example.com",
        username: "deploy-bot",
        apiTokenEncrypted: "v1:iv:tag:cipher",
      });

      // When: I clear it
      await repo.clearJenkinsConnection(created._id);

      // Then: it is null again
      const updated = await repo.findById(created._id);
      expect(updated?.jenkinsConnection).toBeNull();
    });
  });
});
