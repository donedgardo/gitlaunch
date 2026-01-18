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
      expect(updated!.deploymentLogs[0]).toEqual({
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });
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
});
