// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository, Plan } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../repositories/membershipRepository";
import {
  PlanEnforcementService,
  PlanLimitError,
} from "./planEnforcementService";

describe("PlanEnforcementService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let serviceRepo: ServiceRepository;
  let membershipRepo: MembershipRepository;
  let service: PlanEnforcementService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    repoRepo = new RepositoryRepository(db);
    serviceRepo = new ServiceRepository(db);
    membershipRepo = new MembershipRepository(db);
    service = new PlanEnforcementService(
      accountRepo,
      repoRepo,
      serviceRepo,
      membershipRepo,
    );
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});
    await db.collection("services").deleteMany({});
    await db.collection("accountMemberships").deleteMany({});
  });

  describe("canAddRepository", () => {
    it("should allow free account to add first repository", async () => {
      // Given: a free account with no repositories
      const account = await accountRepo.create({
        name: "Free Org",
        slug: "free-org",
      });

      // When: checking if repo can be added
      const result = await service.canAddRepository(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });

    it("should reject free account adding fourth repository", async () => {
      // Given: a free account with three repositories
      const account = await accountRepo.create({
        name: "Free Org 2",
        slug: "free-org-2",
      });
      for (let i = 0; i < 3; i++) {
        await repoRepo.create({
          accountId: account._id,
          githubRepoId: 1234 + i,
          githubFullName: `org/repo${i}`,
          githubOwner: "org",
          githubRepoName: `repo${i}`,
          isPrivate: false,
        });
      }

      // When: checking if 4th repo can be added
      const result = await service.canAddRepository(account._id);

      // Then: it's rejected with upgrade message
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("limit");
      expect(result.upgradeRequired).toBe(true);
    });

    it("should allow Pro account to add up to 10 repositories", async () => {
      // Given: a Pro account with 9 repositories
      const account = await accountRepo.create({
        name: "Pro Org",
        slug: "pro-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_test",
        "sub_test",
        Plan.Pro,
      );

      for (let i = 0; i < 9; i++) {
        await repoRepo.create({
          accountId: account._id,
          githubRepoId: 1000 + i,
          githubFullName: `org/repo${i}`,
          githubOwner: "org",
          githubRepoName: `repo${i}`,
          isPrivate: false,
        });
      }

      // When: checking if 10th repo can be added
      const result = await service.canAddRepository(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });

    it("should reject Pro account exceeding 10 repositories", async () => {
      // Given: a Pro account with 10 repositories
      const account = await accountRepo.create({
        name: "Full Org",
        slug: "full-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_full",
        "sub_full",
        Plan.Pro,
      );

      for (let i = 0; i < 10; i++) {
        await repoRepo.create({
          accountId: account._id,
          githubRepoId: 2000 + i,
          githubFullName: `org/fullrepo${i}`,
          githubOwner: "org",
          githubRepoName: `fullrepo${i}`,
          isPrivate: false,
        });
      }

      // When: checking if 11th repo can be added
      const result = await service.canAddRepository(account._id);

      // Then: it's rejected
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("limit");
    });
  });

  describe("canAddPrivateRepository", () => {
    it("should reject free account adding private repository", async () => {
      // Given: a free account
      const account = await accountRepo.create({
        name: "Free Private",
        slug: "free-private",
      });

      // When: checking if private repo can be added
      const result = await service.canAddPrivateRepository(account._id);

      // Then: it's rejected
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("private");
      expect(result.upgradeRequired).toBe(true);
    });

    it("should allow paid account to add private repository", async () => {
      // Given: a paid account
      const account = await accountRepo.create({
        name: "Paid Private",
        slug: "paid-private",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_priv",
        "sub_priv",
        Plan.Pro,
      );

      // When: checking if private repo can be added
      const result = await service.canAddPrivateRepository(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });
  });

  describe("canAddUser", () => {
    it("should allow free account to have one user", async () => {
      // Given: a free account with no members
      const account = await accountRepo.create({
        name: "Solo Org",
        slug: "solo-org",
      });

      // When: checking if user can be added
      const result = await service.canAddUser(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });

    it("should reject free account adding second user", async () => {
      // Given: a free account with one member
      const account = await accountRepo.create({
        name: "Solo Org 2",
        slug: "solo-org-2",
      });
      await membershipRepo.create({
        userId: new ObjectId(),
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      // When: checking if another user can be added
      const result = await service.canAddUser(account._id);

      // Then: it's rejected
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("User");
      expect(result.upgradeRequired).toBe(true);
    });

    it("should allow paid account to add up to 5 users", async () => {
      // Given: a paid account with 4 members
      const account = await accountRepo.create({
        name: "Team Org",
        slug: "team-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_team",
        "sub_team",
        Plan.Pro,
      );

      for (let i = 0; i < 4; i++) {
        await membershipRepo.create({
          userId: new ObjectId(),
          accountId: account._id,
          role: i === 0 ? MembershipRole.Owner : MembershipRole.Member,
        });
      }

      // When: checking if 5th user can be added
      const result = await service.canAddUser(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });
  });

  describe("canAddService", () => {
    it("should allow free account to add first service", async () => {
      // Given: a free account with no services
      const account = await accountRepo.create({
        name: "Free Service Org",
        slug: "free-service-org",
      });

      // When: checking if service can be added
      const result = await service.canAddService(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });

    it("should reject free account adding fourth service", async () => {
      // Given: a free account with three services
      const account = await accountRepo.create({
        name: "Free Service Org 2",
        slug: "free-service-org-2",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 7001,
        githubFullName: "org/service-repo2",
        githubOwner: "org",
        githubRepoName: "service-repo2",
        isPrivate: false,
      });
      for (let i = 0; i < 3; i++) {
        await serviceRepo.create({
          accountId: account._id,
          repositoryId: repo._id,
          name: `service-${i}`,
        });
      }

      // When: checking if 4th service can be added
      const result = await service.canAddService(account._id);

      // Then: it's rejected with upgrade message
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("limit");
      expect(result.upgradeRequired).toBe(true);
    });

    it("should allow paid account to add up to 10 services", async () => {
      // Given: a paid account with 9 services
      const account = await accountRepo.create({
        name: "Paid Service Org",
        slug: "paid-service-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_svc",
        "sub_svc",
        Plan.Pro,
      );
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 7002,
        githubFullName: "org/paid-service-repo",
        githubOwner: "org",
        githubRepoName: "paid-service-repo",
        isPrivate: false,
      });

      for (let i = 0; i < 9; i++) {
        await serviceRepo.create({
          accountId: account._id,
          repositoryId: repo._id,
          name: `service-${i}`,
        });
      }

      // When: checking if 10th service can be added
      const result = await service.canAddService(account._id);

      // Then: it's allowed
      expect(result.allowed).toBe(true);
    });

    it("should reject paid account exceeding 10 services", async () => {
      // Given: a paid account with 10 services
      const account = await accountRepo.create({
        name: "Full Service Org",
        slug: "full-service-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_full_svc",
        "sub_full_svc",
        Plan.Pro,
      );
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 7003,
        githubFullName: "org/full-service-repo",
        githubOwner: "org",
        githubRepoName: "full-service-repo",
        isPrivate: false,
      });

      for (let i = 0; i < 10; i++) {
        await serviceRepo.create({
          accountId: account._id,
          repositoryId: repo._id,
          name: `full-service-${i}`,
        });
      }

      // When: checking if 11th service can be added
      const result = await service.canAddService(account._id);

      // Then: it's rejected
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("limit");
    });
  });

  describe("getUsage", () => {
    it("should return current usage and limits", async () => {
      // Given: a free account with some usage
      const account = await accountRepo.create({
        name: "Usage Org",
        slug: "usage-org",
      });
      await repoRepo.create({
        accountId: account._id,
        githubRepoId: 5000,
        githubFullName: "org/usage-repo",
        githubOwner: "org",
        githubRepoName: "usage-repo",
        isPrivate: false,
      });
      await membershipRepo.create({
        userId: new ObjectId(),
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      // When: I get usage
      const usage = await service.getUsage(account._id);

      // Then: I see current usage and Free plan limits
      expect(usage.repositories.current).toBe(1);
      expect(usage.repositories.limit).toBe(3);
      expect(usage.services.limit).toBe(3);
      expect(usage.users.current).toBe(1);
      expect(usage.users.limit).toBe(1);
      expect(usage.privateReposAllowed).toBe(false);
    });

    it("should show Pro limits for upgraded account", async () => {
      // Given: a Pro account
      const account = await accountRepo.create({
        name: "Pro Usage",
        slug: "pro-usage",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_usage",
        "sub_usage",
        Plan.Pro,
      );

      // When: I get usage
      const usage = await service.getUsage(account._id);

      // Then: I see Pro limits
      expect(usage.repositories.limit).toBe(10);
      expect(usage.services.limit).toBe(10);
      expect(usage.users.limit).toBe(5);
      expect(usage.privateReposAllowed).toBe(true);
    });
  });

  describe("enforceRepositoryLimit", () => {
    it("should throw PlanLimitError when limit exceeded", async () => {
      // Given: a free account at repository limit (3 repos)
      const account = await accountRepo.create({
        name: "Enforce Org",
        slug: "enforce-org",
      });
      for (let i = 0; i < 3; i++) {
        await repoRepo.create({
          accountId: account._id,
          githubRepoId: 6000 + i,
          githubFullName: `org/enforce-repo${i}`,
          githubOwner: "org",
          githubRepoName: `enforce-repo${i}`,
          isPrivate: false,
        });
      }

      // When/Then: enforcing throws error
      await expect(service.enforceRepositoryLimit(account._id)).rejects.toThrow(
        PlanLimitError,
      );
    });

    it("should not throw when under limit", async () => {
      // Given: a free account under limit
      const account = await accountRepo.create({
        name: "Under Org",
        slug: "under-org",
      });

      // When/Then: enforcing doesn't throw
      await expect(
        service.enforceRepositoryLimit(account._id),
      ).resolves.not.toThrow();
    });
  });

  describe("canAddEnvironment", () => {
    it("should allow free account with 1 environment to add another", async () => {
      // Given: a free account with a service containing 1 environment
      const account = await accountRepo.create({
        name: "Free Env Org",
        slug: "free-env-org",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 9001,
        githubFullName: "org/env-repo",
        githubOwner: "org",
        githubRepoName: "env-repo",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "env-service",
        environments: [{ name: "staging", order: 0 }],
      });

      // When: checking if environment can be added
      const result = await service.canAddEnvironment(account._id, svc._id);

      // Then: it's allowed (free limit is 2)
      expect(result.allowed).toBe(true);
    });

    it("should reject free account with 2 environments from adding more", async () => {
      // Given: a free account with a service at default 2 environments
      const account = await accountRepo.create({
        name: "Free Env Org 2",
        slug: "free-env-org-2",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 9002,
        githubFullName: "org/env-repo-2",
        githubOwner: "org",
        githubRepoName: "env-repo-2",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "env-service-2",
        environments: [
          { name: "staging", order: 0 },
          { name: "prod", order: 1 },
        ],
      });

      // When: checking if 3rd environment can be added
      const result = await service.canAddEnvironment(account._id, svc._id);

      // Then: it's rejected with upgrade message
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Environment limit reached (2/2)");
      expect(result.upgradeRequired).toBe(true);
    });

    it("should allow Pro account with 9 environments to add another", async () => {
      // Given: a Pro account with 9 environments
      const account = await accountRepo.create({
        name: "Pro Env Org",
        slug: "pro-env-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_pro_env",
        "sub_pro_env",
        Plan.Pro,
      );
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 9003,
        githubFullName: "org/pro-env-repo",
        githubOwner: "org",
        githubRepoName: "pro-env-repo",
        isPrivate: false,
      });
      const environments = Array.from({ length: 9 }, (_, i) => ({
        name: `env${i}`,
        order: i,
      }));
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "pro-env-service",
        environments,
      });

      // When: checking if 10th environment can be added
      const result = await service.canAddEnvironment(account._id, svc._id);

      // Then: it's allowed (Pro limit is 10)
      expect(result.allowed).toBe(true);
    });

    it("should reject Pro account with 10 environments from adding more", async () => {
      // Given: a Pro account with 10 environments
      const account = await accountRepo.create({
        name: "Pro Env Full Org",
        slug: "pro-env-full-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_pro_env_full",
        "sub_pro_env_full",
        Plan.Pro,
      );
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 9004,
        githubFullName: "org/pro-env-full-repo",
        githubOwner: "org",
        githubRepoName: "pro-env-full-repo",
        isPrivate: false,
      });
      const environments = Array.from({ length: 10 }, (_, i) => ({
        name: `env${i}`,
        order: i,
      }));
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "pro-env-full-service",
        environments,
      });

      // When: checking if 11th environment can be added
      const result = await service.canAddEnvironment(account._id, svc._id);

      // Then: it's rejected
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Environment limit reached (10/10)");
      expect(result.upgradeRequired).toBe(true);
    });

    it("should allow Team account with 50 environments to add more", async () => {
      // Given: a Team account with 50 environments
      const account = await accountRepo.create({
        name: "Team Env Org",
        slug: "team-env-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_team_env",
        "sub_team_env",
        Plan.Team,
      );
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 9005,
        githubFullName: "org/team-env-repo",
        githubOwner: "org",
        githubRepoName: "team-env-repo",
        isPrivate: false,
      });
      const environments = Array.from({ length: 50 }, (_, i) => ({
        name: `env${i}`,
        order: i,
      }));
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "team-env-service",
        environments,
      });

      // When: checking if another environment can be added
      const result = await service.canAddEnvironment(account._id, svc._id);

      // Then: it's allowed (Team limit is 999)
      expect(result.allowed).toBe(true);
    });

    it("should return not found when account does not exist", async () => {
      // Given: a non-existent account ID
      const fakeAccountId = new ObjectId();
      const fakeServiceId = new ObjectId();

      // When: checking if environment can be added
      const result = await service.canAddEnvironment(
        fakeAccountId,
        fakeServiceId,
      );

      // Then: it's rejected with not found message
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Account not found");
    });

    it("should return not found when service does not exist", async () => {
      // Given: an account but non-existent service
      const account = await accountRepo.create({
        name: "No Service Org",
        slug: "no-service-org",
      });
      const fakeServiceId = new ObjectId();

      // When: checking if environment can be added
      const result = await service.canAddEnvironment(
        account._id,
        fakeServiceId,
      );

      // Then: it's rejected with not found message
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Service not found");
    });
  });

  describe("enforceEnvironmentLimit", () => {
    it("should throw PlanLimitError when environment limit exceeded", async () => {
      // Given: a free account with service at environment limit (2)
      const account = await accountRepo.create({
        name: "Enforce Env Org",
        slug: "enforce-env-org",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 9100,
        githubFullName: "org/enforce-env-repo",
        githubOwner: "org",
        githubRepoName: "enforce-env-repo",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "enforce-env-service",
        environments: [
          { name: "staging", order: 0 },
          { name: "prod", order: 1 },
        ],
      });

      // When/Then: enforcing throws error
      await expect(
        service.enforceEnvironmentLimit(account._id, svc._id),
      ).rejects.toThrow(PlanLimitError);
    });

    it("should not throw when under environment limit", async () => {
      // Given: a free account with service under limit
      const account = await accountRepo.create({
        name: "Under Env Org",
        slug: "under-env-org",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 9101,
        githubFullName: "org/under-env-repo",
        githubOwner: "org",
        githubRepoName: "under-env-repo",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "under-env-service",
        environments: [{ name: "staging", order: 0 }],
      });

      // When/Then: enforcing doesn't throw
      await expect(
        service.enforceEnvironmentLimit(account._id, svc._id),
      ).resolves.not.toThrow();
    });
  });

  describe("isInGracePeriod", () => {
    it("should return false when paymentFailedAt is null", async () => {
      // Given: an account with no payment failure
      const account = await accountRepo.create({
        name: "No Payment Failure",
        slug: "no-payment-failure",
      });

      // When: I check if in grace period
      const inGracePeriod = service.isInGracePeriod(
        await accountRepo.findById(account._id),
      );

      // Then: it's not in grace period
      expect(inGracePeriod).toBe(false);
    });

    it("should return true when paymentFailedAt is within 7 days", async () => {
      // Given: an account with payment failure 3 days ago
      const account = await accountRepo.create({
        name: "Recent Failure",
        slug: "recent-failure",
      });
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await accountRepo.setPaymentFailed(account._id);
      // Manually update to specific date for testing
      await accountRepo["collection"].updateOne(
        { _id: account._id },
        { $set: { paymentFailedAt: threeDaysAgo } },
      );

      // When: I check if in grace period
      const accountWithFailure = await accountRepo.findById(account._id);
      const inGracePeriod = service.isInGracePeriod(accountWithFailure);

      // Then: it's in grace period
      expect(inGracePeriod).toBe(true);
    });

    it("should return false when paymentFailedAt is exactly 7 days ago", async () => {
      // Given: an account with payment failure exactly 7 days ago
      const account = await accountRepo.create({
        name: "Seven Days Ago",
        slug: "seven-days-ago",
      });
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await accountRepo.setPaymentFailed(account._id);
      await accountRepo["collection"].updateOne(
        { _id: account._id },
        { $set: { paymentFailedAt: sevenDaysAgo } },
      );

      // When: I check if in grace period
      const accountWithFailure = await accountRepo.findById(account._id);
      const inGracePeriod = service.isInGracePeriod(accountWithFailure);

      // Then: it's not in grace period (grace has expired)
      expect(inGracePeriod).toBe(false);
    });

    it("should return false when paymentFailedAt is 10 days ago", async () => {
      // Given: an account with payment failure 10 days ago
      const account = await accountRepo.create({
        name: "Ten Days Ago",
        slug: "ten-days-ago",
      });
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await accountRepo.setPaymentFailed(account._id);
      await accountRepo["collection"].updateOne(
        { _id: account._id },
        { $set: { paymentFailedAt: tenDaysAgo } },
      );

      // When: I check if in grace period
      const accountWithFailure = await accountRepo.findById(account._id);
      const inGracePeriod = service.isInGracePeriod(accountWithFailure);

      // Then: it's not in grace period
      expect(inGracePeriod).toBe(false);
    });
  });

  describe("getGracePeriodDaysRemaining", () => {
    it("should return 0 when paymentFailedAt is null", async () => {
      // Given: an account with no payment failure
      const account = await accountRepo.create({
        name: "No Failure Days",
        slug: "no-failure-days",
      });

      // When: I get grace period days remaining
      const daysRemaining = service.getGracePeriodDaysRemaining(
        await accountRepo.findById(account._id),
      );

      // Then: it's 0 days
      expect(daysRemaining).toBe(0);
    });

    it("should return 4 days when paymentFailedAt is 3 days ago", async () => {
      // Given: an account with payment failure 3 days ago
      const account = await accountRepo.create({
        name: "Three Days Grace",
        slug: "three-days-grace",
      });
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await accountRepo.setPaymentFailed(account._id);
      await accountRepo["collection"].updateOne(
        { _id: account._id },
        { $set: { paymentFailedAt: threeDaysAgo } },
      );

      // When: I get grace period days remaining
      const accountWithFailure = await accountRepo.findById(account._id);
      const daysRemaining =
        service.getGracePeriodDaysRemaining(accountWithFailure);

      // Then: it's 4 days (7 - 3)
      expect(daysRemaining).toBe(4);
    });

    it("should return 0 when grace period has expired", async () => {
      // Given: an account with payment failure 10 days ago
      const account = await accountRepo.create({
        name: "Expired Grace",
        slug: "expired-grace",
      });
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await accountRepo.setPaymentFailed(account._id);
      await accountRepo["collection"].updateOne(
        { _id: account._id },
        { $set: { paymentFailedAt: tenDaysAgo } },
      );

      // When: I get grace period days remaining
      const accountWithFailure = await accountRepo.findById(account._id);
      const daysRemaining =
        service.getGracePeriodDaysRemaining(accountWithFailure);

      // Then: it's 0 days
      expect(daysRemaining).toBe(0);
    });
  });

  describe("getAccountState", () => {
    it("should return isReadOnly false when Free account is within limits", async () => {
      // Given: a Free account with 2/3 repos, 1/3 services
      const account = await accountRepo.create({
        name: "Within Limits",
        slug: "within-limits",
      });
      await repoRepo.create({
        accountId: account._id,
        githubRepoId: 1001,
        githubFullName: "org/repo1",
        githubOwner: "org",
        githubRepoName: "repo1",
        isPrivate: false,
      });
      await repoRepo.create({
        accountId: account._id,
        githubRepoId: 1002,
        githubFullName: "org/repo2",
        githubOwner: "org",
        githubRepoName: "repo2",
        isPrivate: false,
      });

      // When: I get account state
      const state = await service.getAccountState(account._id);

      // Then: isReadOnly is false (within limits)
      expect(state.isReadOnly).toBe(false);
      expect(state.plan).toBe(Plan.Free);
      expect(state.usage.repositories.current).toBe(2);
      expect(state.usage.repositories.limit).toBe(3);
      expect(state.trialDaysRemaining).toBe(0);
    });

    it("should return isReadOnly true when Free account exceeds repo limit", async () => {
      // Given: a Free account with 5/3 repos (downgraded from Pro with resources)
      const account = await accountRepo.create({
        name: "Over Repo Limit",
        slug: "over-repo-limit",
      });
      // Create 5 repos
      for (let i = 1; i <= 5; i++) {
        await repoRepo.create({
          accountId: account._id,
          githubRepoId: 2000 + i,
          githubFullName: `org/repo${i}`,
          githubOwner: "org",
          githubRepoName: `repo${i}`,
          isPrivate: false,
        });
      }

      // When: I get account state
      const state = await service.getAccountState(account._id);

      // Then: isReadOnly is true (exceeded repo limit)
      expect(state.isReadOnly).toBe(true);
      expect(state.plan).toBe(Plan.Free);
      expect(state.usage.repositories.current).toBe(5);
      expect(state.usage.repositories.limit).toBe(3);
    });

    it("should return isReadOnly true when Free account exceeds service limit", async () => {
      // Given: a Free account with 5/3 services
      const account = await accountRepo.create({
        name: "Over Service Limit",
        slug: "over-service-limit",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 3000,
        githubFullName: "org/services-repo",
        githubOwner: "org",
        githubRepoName: "services-repo",
        isPrivate: false,
      });
      // Create 5 services
      for (let i = 1; i <= 5; i++) {
        await serviceRepo.create({
          accountId: account._id,
          repositoryId: repo._id,
          name: `service-${i}`,
          environments: [{ name: "prod", order: 0 }],
        });
      }

      // When: I get account state
      const state = await service.getAccountState(account._id);

      // Then: isReadOnly is true (exceeded service limit)
      expect(state.isReadOnly).toBe(true);
      expect(state.plan).toBe(Plan.Free);
      expect(state.usage.services.current).toBe(5);
      expect(state.usage.services.limit).toBe(3);
    });

    it("should return isReadOnly false when Pro account is within limits", async () => {
      // Given: a Pro account with 8/10 repos
      const account = await accountRepo.create({
        name: "Pro Within Limits",
        slug: "pro-within-limits",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_pro",
        "sub_pro",
        Plan.Pro,
      );
      // Create 8 repos
      for (let i = 1; i <= 8; i++) {
        await repoRepo.create({
          accountId: account._id,
          githubRepoId: 4000 + i,
          githubFullName: `org/pro-repo${i}`,
          githubOwner: "org",
          githubRepoName: `pro-repo${i}`,
          isPrivate: false,
        });
      }

      // When: I get account state
      const state = await service.getAccountState(account._id);

      // Then: isReadOnly is false (within Pro limits)
      expect(state.isReadOnly).toBe(false);
      expect(state.plan).toBe(Plan.Pro);
      expect(state.usage.repositories.current).toBe(8);
      expect(state.usage.repositories.limit).toBe(10);
    });

    it("should return trialDaysRemaining when account is on trial", async () => {
      // Given: an account with trial (7 days remaining)
      const account = await accountRepo.create({
        name: "Trial Account",
        slug: "trial-account",
      });
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await accountRepo.setTrialEndsAt(account._id, trialEndsAt);
      await accountRepo.selectPlan(account._id, Plan.Pro);

      // When: I get account state
      const state = await service.getAccountState(account._id);

      // Then: trialDaysRemaining is computed
      expect(state.trialDaysRemaining).toBeGreaterThanOrEqual(6);
      expect(state.trialDaysRemaining).toBeLessThanOrEqual(7);
      expect(state.plan).toBe(Plan.Pro);
    });

    it("should return trialDaysRemaining 0 when no trial", async () => {
      // Given: an account with no trial
      const account = await accountRepo.create({
        name: "No Trial",
        slug: "no-trial-state",
      });

      // When: I get account state
      const state = await service.getAccountState(account._id);

      // Then: trialDaysRemaining is 0
      expect(state.trialDaysRemaining).toBe(0);
    });

    it("should return paymentFailed false when no payment failure", async () => {
      // Given: an account with no payment failure
      const account = await accountRepo.create({
        name: "No Payment Issue",
        slug: "no-payment-issue",
      });

      // When: I get account state
      const state = await service.getAccountState(account._id);

      // Then: paymentFailed is false
      expect(state.paymentFailed).toBe(false);
      expect(state.gracePeriodDaysRemaining).toBe(0);
    });

    it("should return paymentFailed true and gracePeriodDaysRemaining when in grace period", async () => {
      // Given: an account with payment failure 2 days ago
      const account = await accountRepo.create({
        name: "Grace Payment",
        slug: "grace-payment",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_grace",
        "sub_grace",
        Plan.Pro,
      );
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await accountRepo.setPaymentFailed(account._id);
      await accountRepo["collection"].updateOne(
        { _id: account._id },
        { $set: { paymentFailedAt: twoDaysAgo } },
      );

      // When: I get account state
      const state = await service.getAccountState(account._id);

      // Then: paymentFailed is true and grace period days are computed
      expect(state.paymentFailed).toBe(true);
      expect(state.gracePeriodDaysRemaining).toBe(5);
    });

    it("should return isReadOnly false when payment failed but in grace period", async () => {
      // Given: a Pro account with payment failure 2 days ago (in grace)
      const account = await accountRepo.create({
        name: "Pro Grace",
        slug: "pro-grace",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_pro_grace",
        "sub_pro_grace",
        Plan.Pro,
      );
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await accountRepo.setPaymentFailed(account._id);
      await accountRepo["collection"].updateOne(
        { _id: account._id },
        { $set: { paymentFailedAt: twoDaysAgo } },
      );
      // Create 8 repos (within Pro limit of 10)
      for (let i = 0; i < 8; i++) {
        await repoRepo.create({
          accountId: account._id,
          githubRepoId: 8000 + i,
          githubFullName: `org/grace-repo${i}`,
          githubOwner: "org",
          githubRepoName: `grace-repo${i}`,
          isPrivate: false,
        });
      }

      // When: I get account state
      const state = await service.getAccountState(account._id);

      // Then: isReadOnly is false (payment failed but in grace period)
      expect(state.isReadOnly).toBe(false);
      expect(state.paymentFailed).toBe(true);
      expect(state.gracePeriodDaysRemaining).toBe(5);
    });

    it("should return isReadOnly true when payment failed and grace period expired", async () => {
      // Given: a Pro account with payment failure 8 days ago (grace expired)
      const account = await accountRepo.create({
        name: "Expired Grace Pro",
        slug: "expired-grace-pro",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_expired",
        "sub_expired",
        Plan.Pro,
      );
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      await accountRepo.setPaymentFailed(account._id);
      await accountRepo["collection"].updateOne(
        { _id: account._id },
        { $set: { paymentFailedAt: eightDaysAgo } },
      );
      // Create 8 repos (within Pro limit of 10, but payment failed)
      for (let i = 0; i < 8; i++) {
        await repoRepo.create({
          accountId: account._id,
          githubRepoId: 9000 + i,
          githubFullName: `org/expired-repo${i}`,
          githubOwner: "org",
          githubRepoName: `expired-repo${i}`,
          isPrivate: false,
        });
      }

      // When: I get account state
      const state = await service.getAccountState(account._id);

      // Then: isReadOnly is true (payment failed and grace expired)
      expect(state.isReadOnly).toBe(true);
      expect(state.paymentFailed).toBe(true);
      expect(state.gracePeriodDaysRemaining).toBe(0);
    });
  });

  describe("on a self-hosted instance", () => {
    // A customer who bought a self-hosted license never sees Stripe, so the
    // SaaS tiers must not govern their install.
    const licensed = {
      kind: "self-hosted" as const,
      license: {
        licensedTo: "Acme Corp",
        maxUsers: 2,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
      },
    };

    const selfHosted = (
      mode: typeof licensed | { kind: "self-hosted"; license: null },
    ) =>
      new PlanEnforcementService(
        accountRepo,
        repoRepo,
        serviceRepo,
        membershipRepo,
        mode,
      );

    const freeAccount = () =>
      accountRepo.create({ name: "Acme", slug: `acme-${new ObjectId()}` });

    it("should not throttle a licensed install with the Free tier's service limit", async () => {
      // Given a Free-plan account on a licensed self-hosted instance, already
      // at the SaaS limit of 3 services
      const account = await freeAccount();
      for (let i = 0; i < 4; i++) {
        await serviceRepo.create({
          accountId: account._id,
          name: `svc-${i}`,
          repoUrl: "https://github.com/acme/api",
        });
      }

      // When it adds another service
      const result = await selfHosted(licensed).canAddService(account._id);

      // Then the license, not the plan, decides — and it allows it
      expect(result.allowed).toBe(true);
    });

    it("should allow private repositories on a licensed install", async () => {
      // Given a Free-plan account, which is public-repos-only on SaaS
      const account = await freeAccount();

      // When it connects a private repository
      const result = await selfHosted(licensed).canAddPrivateRepository(
        account._id,
      );

      // Then the self-hosted license permits it
      expect(result.allowed).toBe(true);
    });

    it("should still enforce the seats the license sold", async () => {
      // Given a 2-seat license with both seats taken
      const account = await freeAccount();
      for (let i = 0; i < 2; i++) {
        await membershipRepo.create({
          accountId: account._id,
          userId: new ObjectId(),
          role: MembershipRole.Member,
        });
      }

      // When a third user is added
      const result = await selfHosted(licensed).canAddUser(account._id);

      // Then seats are the one thing a self-hosted license still meters
      expect(result.allowed).toBe(false);
    });

    it("should let an unlicensed instance add services freely", async () => {
      // Given someone running open core with no license
      const account = await freeAccount();

      // When they add a service
      const result = await selfHosted({
        kind: "self-hosted",
        license: null,
      }).canAddService(account._id);

      // Then nothing stops them — open core sells seats, not capacity, and a
      // single-seat install has to be a complete product
      expect(result.allowed).toBe(true);
    });

    it("should hold an unlicensed instance to a single seat", async () => {
      // Given open core, whose one seat is taken by the owner
      const account = await freeAccount();
      await membershipRepo.create({
        accountId: account._id,
        userId: new ObjectId(),
        role: MembershipRole.Owner,
      });

      // When a second person is invited
      const result = await selfHosted({
        kind: "self-hosted",
        license: null,
      }).canAddUser(account._id);

      // Then the seat cap bites, and not with a "buy a plan" message — there is
      // no Stripe checkout on a self-hosted install
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(
        "Seat limit reached (1/1). Additional seats require a GitLaunch license.",
      );
      expect(result.upgradeRequired).toBe(false);
    });

    it("should never mark a self-hosted account read-only for payment state", async () => {
      // Given an account whose payment failed long ago — impossible to fix on
      // an install with no Stripe
      const account = await freeAccount();
      const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await db
        .collection("accounts")
        .updateOne(
          { _id: account._id },
          { $set: { paymentFailedAt: longAgo } },
        );

      // When the dashboard resolves its state
      const state = await selfHosted(licensed).getAccountState(account._id);

      // Then the install keeps working
      expect(state.isReadOnly).toBe(false);
    });
  });
});
