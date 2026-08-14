import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { BuildRepository } from "./buildRepository";
import { DeploymentStatus } from "../services/service/deploymentStatus";

describe("BuildRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: BuildRepository;

  const testAccountId = new ObjectId();
  const testServiceId = new ObjectId();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new BuildRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("builds").deleteMany({});
  });

  describe("create", () => {
    it("should create build with tenant isolation fields", async () => {
      // Given: build details for an account and service
      const input = {
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "abc123",
      };

      // When: I create the build
      const build = await repo.create(input);

      // Then: I get back a build with tenant isolation fields
      expect(build._id).toBeDefined();
      expect(build.accountId.toString()).toBe(testAccountId.toString());
      expect(build.serviceId.toString()).toBe(testServiceId.toString());
      expect(build.buildId).toBe("abc123");
      expect(build.deployments).toEqual({});
      expect(build.deploymentLogs).toEqual([]);
      expect(build.createdAt).toBeInstanceOf(Date);
      expect(build.updatedAt).toBeInstanceOf(Date);
    });

    it("should persist a commit message when one is reported", async () => {
      // Given: build details that include the commit message
      const input = {
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "with-message",
        message: "Fix session cookie expiry",
      };

      // When: I create the build
      const build = await repo.create(input);

      // Then: the commit message is stored on the build
      expect(build.message).toBe("Fix session cookie expiry");
    });

    it("should return existing build if buildId already exists for account/repo", async () => {
      // Given: a build already exists
      const input = {
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "existing-build",
      };
      const first = await repo.create(input);

      // When: I try to create another build with same buildId
      const second = await repo.create(input);

      // Then: I get back the existing build
      expect(second._id.toString()).toBe(first._id.toString());
    });

    it("should allow same buildId for different repositories", async () => {
      // Given: a build exists for repo A
      const serviceA = new ObjectId();
      const serviceB = new ObjectId();

      await repo.create({
        accountId: testAccountId,
        serviceId: serviceA,
        buildId: "same-build-id",
      });

      // When: I create a build with same buildId for service B
      const buildB = await repo.create({
        accountId: testAccountId,
        serviceId: serviceB,
        buildId: "same-build-id",
      });

      // Then: a new build is created
      expect(buildB.serviceId.toString()).toBe(serviceB.toString());
    });
  });

  describe("findByBuildId", () => {
    it("should find build by accountId, serviceId, and buildId", async () => {
      // Given: a build exists
      const input = {
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "find-me",
      };
      await repo.create(input);

      // When: I look up by all three keys
      const found = await repo.findByBuildId(
        testAccountId,
        testServiceId,
        "find-me",
      );

      // Then: I find the build
      expect(found).not.toBeNull();
      expect(found!.buildId).toBe("find-me");
    });

    it("should return null if buildId not found", async () => {
      // Given: no matching build exists
      // When: I look up a non-existent buildId
      const found = await repo.findByBuildId(
        testAccountId,
        testServiceId,
        "non-existent",
      );

      // Then: I get null
      expect(found).toBeNull();
    });

    it("should enforce tenant isolation - cannot find other account's builds", async () => {
      // Given: a build exists for account A
      const accountA = new ObjectId();
      const accountB = new ObjectId();

      await repo.create({
        accountId: accountA,
        serviceId: testServiceId,
        buildId: "tenant-build",
      });

      // When: account B tries to find the build
      const found = await repo.findByBuildId(
        accountB,
        testServiceId,
        "tenant-build",
      );

      // Then: it's not found (tenant isolation)
      expect(found).toBeNull();
    });
  });

  describe("findByAccountAndService", () => {
    it("should return builds for specific account and repo sorted by date desc", async () => {
      // Given: multiple builds exist
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "build-1",
      });

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "build-2",
      });

      // When: I list builds
      const builds = await repo.findByAccountAndService(
        testAccountId,
        testServiceId,
      );

      // Then: I get them sorted by date descending (newest first)
      expect(builds).toHaveLength(2);
      expect(builds[0].buildId).toBe("build-2");
      expect(builds[1].buildId).toBe("build-1");
    });

    it("should not return builds from other accounts", async () => {
      // Given: builds exist for different accounts
      const accountA = new ObjectId();
      const accountB = new ObjectId();

      await repo.create({
        accountId: accountA,
        serviceId: testServiceId,
        buildId: "build-a",
      });
      await repo.create({
        accountId: accountB,
        serviceId: testServiceId,
        buildId: "build-b",
      });

      // When: account A lists builds
      const builds = await repo.findByAccountAndService(
        accountA,
        testServiceId,
      );

      // Then: only account A's builds are returned
      expect(builds).toHaveLength(1);
      expect(builds[0].buildId).toBe("build-a");
    });

    it("should return empty array when no builds exist", async () => {
      // Given: no builds for this account/repo
      // When: I list builds
      const builds = await repo.findByAccountAndService(
        new ObjectId(),
        new ObjectId(),
      );

      // Then: I get empty array
      expect(builds).toEqual([]);
    });
  });

  describe("updateDeploymentStatus", () => {
    it("should update deployment status for an environment", async () => {
      // Given: a build exists
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "deploy-me",
      });

      // When: I update the deployment status
      const updated = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "deploy-me",
        "staging",
        DeploymentStatus.DEPLOYING,
      );

      // Then: the deployment status is updated
      expect(updated).not.toBeNull();
      expect(updated!.deployments["staging"]).toBe(DeploymentStatus.DEPLOYING);
    });

    it("should add entry to deployment logs", async () => {
      // Given: a build exists
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "log-me",
      });

      // When: I update the deployment status
      const updated = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "log-me",
        "staging",
        DeploymentStatus.DEPLOYED,
      );

      // Then: a log entry is added
      expect(updated!.deploymentLogs).toHaveLength(1);
      expect(updated!.deploymentLogs[0]).toMatchObject({
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });
    });

    it("should stamp every log entry with the time it happened", async () => {
      // Given: a build exists
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "stamp-me",
      });
      const before = new Date();

      // When: it moves through two statuses
      await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "stamp-me",
        "staging",
        DeploymentStatus.DEPLOYING,
      );
      const updated = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "stamp-me",
        "staging",
        DeploymentStatus.DEPLOYED,
      );
      const after = new Date();

      // Then: each entry carries when it happened, so the four keys can be
      // measured from the log rather than guessed at
      expect(updated!.deploymentLogs).toHaveLength(2);
      for (const log of updated!.deploymentLogs) {
        expect(log.at).toBeInstanceOf(Date);
        expect(log.at.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(log.at.getTime()).toBeLessThanOrEqual(after.getTime());
      }
      expect(updated!.deploymentLogs[0].at.getTime()).toBeLessThanOrEqual(
        updated!.deploymentLogs[1].at.getTime(),
      );
    });

    it("should record the intent when a deployment is a rollback", async () => {
      // Given: a build exists
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "undo-me",
      });

      // When: it is dispatched as a rollback
      const updated = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "undo-me",
        "production",
        DeploymentStatus.DISPATCHING,
        "rollback",
      );

      // Then: the log says so — this is what change failure rate and time to
      // restore are counted from
      expect(updated!.deploymentLogs[0]).toMatchObject({
        environment: "production",
        status: DeploymentStatus.DISPATCHING,
        intent: "rollback",
      });
    });

    it("should carry the intent forward to the statuses that follow it", async () => {
      // Given: a rollback was dispatched
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "carry-me",
      });
      await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "carry-me",
        "production",
        DeploymentStatus.DISPATCHING,
        "rollback",
      );

      // When: the reporter later says it landed
      const updated = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "carry-me",
        "production",
        DeploymentStatus.DEPLOYED,
        "rollback",
      );

      // Then: the deployed entry is a rollback too — restore time is measured
      // from when service actually came back, not when the undo was requested
      const last = updated!.deploymentLogs[updated!.deploymentLogs.length - 1];
      expect(last).toMatchObject({
        status: DeploymentStatus.DEPLOYED,
        intent: "rollback",
      });
    });

    it("should record when the build went live in an environment", async () => {
      // Given: a build exists
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "went-live",
      });
      const before = new Date();

      // When: it becomes deployed in prod
      const updated = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "went-live",
        "prod",
        DeploymentStatus.DEPLOYED,
      );

      // Then: the time it went live in that environment is recorded
      const deployedAt = updated!.deployedAt?.["prod"];
      expect(deployedAt).toBeInstanceOf(Date);
      expect(deployedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("should not record a live time for in-progress deployments", async () => {
      // Given: a build exists
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "still-going",
      });

      // When: it is only dispatching
      const updated = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "still-going",
        "prod",
        DeploymentStatus.DISPATCHING,
      );

      // Then: there is no live time to show yet
      expect(updated!.deployedAt?.["prod"]).toBeUndefined();
    });

    it("should refresh the live time when the same environment is redeployed", async () => {
      // Given: a build that already went live
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "redeploy-me",
      });
      const first = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "redeploy-me",
        "prod",
        DeploymentStatus.DEPLOYED,
      );
      const firstDeployedAt = first!.deployedAt!["prod"];

      await new Promise((r) => setTimeout(r, 10));

      // When: it is deployed to the same environment again
      const second = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "redeploy-me",
        "prod",
        DeploymentStatus.DEPLOYED,
      );

      // Then: the live time reflects the latest deployment
      expect(second!.deployedAt!["prod"].getTime()).toBeGreaterThan(
        firstDeployedAt.getTime(),
      );
    });

    it("should update updatedAt timestamp", async () => {
      // Given: a build exists
      const build = await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "timestamp-me",
      });
      const originalUpdatedAt = build.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      // When: I update the deployment status
      const updated = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "timestamp-me",
        "prod",
        DeploymentStatus.DEPLOYED,
      );

      // Then: updatedAt is updated
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime(),
      );
    });

    it("should return null if build not found", async () => {
      // Given: no matching build
      // When: I try to update non-existent build
      const result = await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "non-existent",
        "staging",
        DeploymentStatus.DEPLOYED,
      );

      // Then: I get null
      expect(result).toBeNull();
    });

    it("should enforce tenant isolation on updates", async () => {
      // Given: a build exists for account A
      const accountA = new ObjectId();
      const accountB = new ObjectId();

      await repo.create({
        accountId: accountA,
        serviceId: testServiceId,
        buildId: "tenant-update",
      });

      // When: account B tries to update it
      const result = await repo.updateDeploymentStatus(
        accountB,
        testServiceId,
        "tenant-update",
        "staging",
        DeploymentStatus.DEPLOYED,
      );

      // Then: update fails (returns null)
      expect(result).toBeNull();
    });
  });

  describe("hasAnyDeployments", () => {
    it("should return false when builds exist but none have deployments", async () => {
      // Given: builds with empty deployments
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "build-no-deploy-1",
      });
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "build-no-deploy-2",
      });

      // When: I check hasAnyDeployments
      const result = await repo.hasAnyDeployments(testAccountId, testServiceId);

      // Then: false is returned
      expect(result).toBe(false);
    });

    it("should return true when at least one build has a deployment", async () => {
      // Given: one build without deployment, one with deployment
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "build-no-deploy",
      });
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "build-with-deploy",
      });
      await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "build-with-deploy",
        "staging",
        DeploymentStatus.DEPLOYED,
      );

      // When: I check hasAnyDeployments
      const result = await repo.hasAnyDeployments(testAccountId, testServiceId);

      // Then: true is returned
      expect(result).toBe(true);
    });

    it("should return false when no builds exist", async () => {
      // Given: no builds for this service
      const emptyServiceId = new ObjectId();

      // When: I check hasAnyDeployments
      const result = await repo.hasAnyDeployments(
        testAccountId,
        emptyServiceId,
      );

      // Then: false is returned
      expect(result).toBe(false);
    });

    it("should enforce tenant isolation", async () => {
      // Given: a build with deployment for account A
      const accountA = new ObjectId();
      const accountB = new ObjectId();

      await repo.create({
        accountId: accountA,
        serviceId: testServiceId,
        buildId: "account-a-build",
      });
      await repo.updateDeploymentStatus(
        accountA,
        testServiceId,
        "account-a-build",
        "staging",
        DeploymentStatus.DEPLOYED,
      );

      // When: account B checks hasAnyDeployments
      const result = await repo.hasAnyDeployments(accountB, testServiceId);

      // Then: false is returned (tenant isolation)
      expect(result).toBe(false);
    });
  });

  describe("clearOtherDeployments", () => {
    it("should clear deployed status from other builds in the same environment", async () => {
      // Given: two builds, build A is deployed to staging
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "build-a",
      });
      await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "build-a",
        "staging",
        DeploymentStatus.DEPLOYED,
      );
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "build-b",
      });

      // When: build B is deployed, we clear other deployments
      const cleared = await repo.clearOtherDeployments(
        testAccountId,
        testServiceId,
        "build-b",
        "staging",
      );

      // Then: build A's staging status is reset to NONE
      const buildA = await repo.findByBuildId(
        testAccountId,
        testServiceId,
        "build-a",
      );
      expect(buildA!.deployments["staging"]).toBe(DeploymentStatus.NONE);
      expect(cleared).toHaveLength(1);
      expect(cleared[0].buildId).toBe("build-a");
    });

    it("should not clear error or cancelled statuses", async () => {
      // Given: builds with ERROR and CANCELLED statuses
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "error-build",
      });
      await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "error-build",
        "staging",
        DeploymentStatus.ERROR,
      );
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "cancelled-build",
      });
      await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "cancelled-build",
        "staging",
        DeploymentStatus.CANCELLED,
      );

      // When: we clear other deployments
      const cleared = await repo.clearOtherDeployments(
        testAccountId,
        testServiceId,
        "new-build",
        "staging",
      );

      // Then: error and cancelled builds are untouched
      const errorBuild = await repo.findByBuildId(
        testAccountId,
        testServiceId,
        "error-build",
      );
      const cancelledBuild = await repo.findByBuildId(
        testAccountId,
        testServiceId,
        "cancelled-build",
      );
      expect(errorBuild!.deployments["staging"]).toBe(DeploymentStatus.ERROR);
      expect(cancelledBuild!.deployments["staging"]).toBe(
        DeploymentStatus.CANCELLED,
      );
      expect(cleared).toHaveLength(0);
    });

    it("should not clear the deploying build itself", async () => {
      // Given: build A is deployed to staging
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "self-build",
      });
      await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "self-build",
        "staging",
        DeploymentStatus.DEPLOYED,
      );

      // When: we clear other deployments excluding self-build
      const cleared = await repo.clearOtherDeployments(
        testAccountId,
        testServiceId,
        "self-build",
        "staging",
      );

      // Then: self-build is untouched
      const selfBuild = await repo.findByBuildId(
        testAccountId,
        testServiceId,
        "self-build",
      );
      expect(selfBuild!.deployments["staging"]).toBe(DeploymentStatus.DEPLOYED);
      expect(cleared).toHaveLength(0);
    });

    it("should only clear builds in the specified environment", async () => {
      // Given: build A is deployed to prod, build B is deployed to staging
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "prod-build",
      });
      await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "prod-build",
        "prod",
        DeploymentStatus.DEPLOYED,
      );

      // When: we clear other deployments for staging
      const cleared = await repo.clearOtherDeployments(
        testAccountId,
        testServiceId,
        "new-build",
        "staging",
      );

      // Then: prod-build's prod status is untouched
      const prodBuild = await repo.findByBuildId(
        testAccountId,
        testServiceId,
        "prod-build",
      );
      expect(prodBuild!.deployments["prod"]).toBe(DeploymentStatus.DEPLOYED);
      expect(cleared).toHaveLength(0);
    });

    it("should add a NONE log entry for each cleared build", async () => {
      // Given: build A is deployed to staging
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "log-build",
      });
      await repo.updateDeploymentStatus(
        testAccountId,
        testServiceId,
        "log-build",
        "staging",
        DeploymentStatus.DEPLOYED,
      );

      // When: we clear other deployments
      await repo.clearOtherDeployments(
        testAccountId,
        testServiceId,
        "another-build",
        "staging",
      );

      // Then: a NONE log entry is added
      const logBuild = await repo.findByBuildId(
        testAccountId,
        testServiceId,
        "log-build",
      );
      const lastLog =
        logBuild!.deploymentLogs[logBuild!.deploymentLogs.length - 1];
      expect(lastLog).toMatchObject({
        environment: "staging",
        status: DeploymentStatus.NONE,
      });
    });

    it("should enforce tenant isolation", async () => {
      // Given: build in account A is deployed to staging
      const accountA = new ObjectId();
      const accountB = new ObjectId();

      await repo.create({
        accountId: accountA,
        serviceId: testServiceId,
        buildId: "tenant-build",
      });
      await repo.updateDeploymentStatus(
        accountA,
        testServiceId,
        "tenant-build",
        "staging",
        DeploymentStatus.DEPLOYED,
      );

      // When: account B clears other deployments
      const cleared = await repo.clearOtherDeployments(
        accountB,
        testServiceId,
        "other-build",
        "staging",
      );

      // Then: account A's build is untouched
      const tenantBuild = await repo.findByBuildId(
        accountA,
        testServiceId,
        "tenant-build",
      );
      expect(tenantBuild!.deployments["staging"]).toBe(
        DeploymentStatus.DEPLOYED,
      );
      expect(cleared).toHaveLength(0);
    });
  });

  describe("ensureIndexes", () => {
    it("should create unique compound index that prevents duplicates", async () => {
      // Given: indexes are created
      await repo.ensureIndexes();

      // And: a build exists
      await repo.create({
        accountId: testAccountId,
        serviceId: testServiceId,
        buildId: "unique-test",
      });

      // When: I try to insert a duplicate directly (bypassing create logic)
      // Then: it should throw a duplicate key error
      await expect(
        db.collection("builds").insertOne({
          accountId: testAccountId,
          serviceId: testServiceId,
          buildId: "unique-test",
          deployments: {},
          deploymentLogs: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ).rejects.toThrow(/duplicate key/);
    });

    it("should be idempotent - calling multiple times succeeds", async () => {
      // When: I call ensureIndexes multiple times
      await repo.ensureIndexes();
      await repo.ensureIndexes();
      await repo.ensureIndexes();

      // Then: no error is thrown (indexes already exist)
      const indexes = await db.collection("builds").indexes();
      expect(indexes.length).toBeGreaterThanOrEqual(3); // _id + 2 custom indexes
    });
  });

  describe("findPaginated", () => {
    it("should return first page of builds sorted newest first", async () => {
      // Given: 25 builds exist for an account and service
      for (let i = 1; i <= 25; i++) {
        await repo.create({
          accountId: testAccountId,
          serviceId: testServiceId,
          buildId: `build-${i}`,
        });
        // Small delay to ensure distinct timestamps
        await new Promise((r) => setTimeout(r, 5));
      }

      // When: I request page 1 with 10 per page
      const result = await repo.findPaginated(
        testAccountId,
        testServiceId,
        1,
        10,
      );

      // Then: I get the first 10 builds, sorted newest first
      expect(result.builds).toHaveLength(10);
      expect(result.builds[0].buildId).toBe("build-25");
      expect(result.builds[9].buildId).toBe("build-16");
      expect(result.total).toBe(25);
      expect(result.hasMore).toBe(true);
    });

    it("should return second page of builds", async () => {
      // Given: 25 builds exist
      for (let i = 1; i <= 25; i++) {
        await repo.create({
          accountId: testAccountId,
          serviceId: testServiceId,
          buildId: `build-${i}`,
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // When: I request page 2 with 10 per page
      const result = await repo.findPaginated(
        testAccountId,
        testServiceId,
        2,
        10,
      );

      // Then: I get builds 11-20
      expect(result.builds).toHaveLength(10);
      expect(result.builds[0].buildId).toBe("build-15");
      expect(result.builds[9].buildId).toBe("build-6");
      expect(result.total).toBe(25);
      expect(result.hasMore).toBe(true);
    });

    it("should return last partial page", async () => {
      // Given: 25 builds exist
      for (let i = 1; i <= 25; i++) {
        await repo.create({
          accountId: testAccountId,
          serviceId: testServiceId,
          buildId: `build-${i}`,
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // When: I request page 3 with 10 per page
      const result = await repo.findPaginated(
        testAccountId,
        testServiceId,
        3,
        10,
      );

      // Then: I get the last 5 builds
      expect(result.builds).toHaveLength(5);
      expect(result.builds[0].buildId).toBe("build-5");
      expect(result.builds[4].buildId).toBe("build-1");
      expect(result.total).toBe(25);
      expect(result.hasMore).toBe(false);
    });

    it("should return empty page when beyond total pages", async () => {
      // Given: 5 builds exist
      for (let i = 1; i <= 5; i++) {
        await repo.create({
          accountId: testAccountId,
          serviceId: testServiceId,
          buildId: `build-${i}`,
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // When: I request page 10 with 10 per page
      const result = await repo.findPaginated(
        testAccountId,
        testServiceId,
        10,
        10,
      );

      // Then: I get empty results
      expect(result.builds).toHaveLength(0);
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(false);
    });

    it("should return empty results when no builds exist", async () => {
      // Given: no builds exist for this account/service
      // When: I request page 1
      const result = await repo.findPaginated(
        testAccountId,
        testServiceId,
        1,
        10,
      );

      // Then: I get empty results
      expect(result.builds).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it("should enforce tenant isolation - not return other account's builds", async () => {
      // Given: builds exist for different accounts
      const accountA = new ObjectId();
      const accountB = new ObjectId();

      for (let i = 1; i <= 10; i++) {
        await repo.create({
          accountId: accountA,
          serviceId: testServiceId,
          buildId: `account-a-build-${i}`,
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      for (let i = 1; i <= 10; i++) {
        await repo.create({
          accountId: accountB,
          serviceId: testServiceId,
          buildId: `account-b-build-${i}`,
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // When: account A requests paginated builds
      const result = await repo.findPaginated(accountA, testServiceId, 1, 10);

      // Then: only account A's builds are returned
      expect(result.builds).toHaveLength(10);
      expect(result.total).toBe(10);
      expect(result.builds[0].buildId).toContain("account-a-build");
      expect(result.hasMore).toBe(false);
    });

    it("should treat page 0 as page 1", async () => {
      // Given: 15 builds exist
      for (let i = 1; i <= 15; i++) {
        await repo.create({
          accountId: testAccountId,
          serviceId: testServiceId,
          buildId: `build-${i}`,
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // When: I request page 0
      const result = await repo.findPaginated(
        testAccountId,
        testServiceId,
        0,
        10,
      );

      // Then: I get first page
      expect(result.builds).toHaveLength(10);
      expect(result.builds[0].buildId).toBe("build-15");
      expect(result.total).toBe(15);
      expect(result.hasMore).toBe(true);
    });

    it("should treat negative page as page 1", async () => {
      // Given: 15 builds exist
      for (let i = 1; i <= 15; i++) {
        await repo.create({
          accountId: testAccountId,
          serviceId: testServiceId,
          buildId: `build-${i}`,
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // When: I request page -1
      const result = await repo.findPaginated(
        testAccountId,
        testServiceId,
        -1,
        10,
      );

      // Then: I get first page
      expect(result.builds).toHaveLength(10);
      expect(result.builds[0].buildId).toBe("build-15");
      expect(result.total).toBe(15);
      expect(result.hasMore).toBe(true);
    });
  });
});
