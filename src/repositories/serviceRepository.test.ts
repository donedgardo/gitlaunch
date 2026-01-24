import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { ServiceRepository } from "./serviceRepository";

describe("ServiceRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: ServiceRepository;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongoServer.getUri());
    db = client.db("test");
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("services").deleteMany({});
    repo = new ServiceRepository(db);
  });

  describe("create", () => {
    it("should create a service with default environments", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();

      // When
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "backend",
      });

      // Then
      expect(service._id).toBeDefined();
      expect(service.accountId).toEqual(accountId);
      expect(service.repositoryId).toEqual(repositoryId);
      expect(service.name).toBe("backend");
      expect(service.environments).toEqual([
        { name: "staging", displayName: "Staging", order: 0 },
        { name: "prod", displayName: "Production", order: 1 },
      ]);
      expect(service.workflowFile).toBe("deploy.yml");
      expect(service.eventType).toBe("deployment");
      expect(service.isActive).toBe(true);
      expect(service.createdAt).toBeInstanceOf(Date);
    });

    it("should create a service with custom environments", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const customEnvs = [
        { name: "dev", displayName: "Development", order: 0 },
        { name: "staging", displayName: "Staging", order: 1 },
        { name: "prod", displayName: "Production", order: 2 },
      ];

      // When
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "frontend",
        environments: customEnvs,
        workflowFile: "deploy-frontend.yml",
        eventType: "deploy-frontend",
      });

      // Then
      expect(service.environments).toEqual(customEnvs);
      expect(service.workflowFile).toBe("deploy-frontend.yml");
      expect(service.eventType).toBe("deploy-frontend");
    });
  });

  describe("findById", () => {
    it("should find a service by id", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const created = await repo.create({
        accountId,
        repositoryId,
        name: "api",
      });

      // When
      const found = await repo.findById(created._id);

      // Then
      expect(found).not.toBeNull();
      expect(found?.name).toBe("api");
    });

    it("should return null for non-existent id", async () => {
      // When
      const found = await repo.findById(new ObjectId());

      // Then
      expect(found).toBeNull();
    });
  });

  describe("findByAccountAndId", () => {
    it("should find a service by account and id", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const created = await repo.create({
        accountId,
        repositoryId,
        name: "worker",
      });

      // When
      const found = await repo.findByAccountAndId(accountId, created._id);

      // Then
      expect(found).not.toBeNull();
      expect(found?.name).toBe("worker");
    });

    it("should return null when account does not match", async () => {
      // Given
      const accountId = new ObjectId();
      const otherAccountId = new ObjectId();
      const repositoryId = new ObjectId();
      const created = await repo.create({
        accountId,
        repositoryId,
        name: "service",
      });

      // When
      const found = await repo.findByAccountAndId(otherAccountId, created._id);

      // Then
      expect(found).toBeNull();
    });
  });

  describe("findByRepositoryId", () => {
    it("should find all services for a repository", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      await repo.create({ accountId, repositoryId, name: "frontend" });
      await repo.create({ accountId, repositoryId, name: "backend" });
      await repo.create({ accountId, repositoryId, name: "worker" });

      // When
      const services = await repo.findByRepositoryId(accountId, repositoryId);

      // Then
      expect(services).toHaveLength(3);
      expect(services.map((s) => s.name).sort()).toEqual([
        "backend",
        "frontend",
        "worker",
      ]);
    });

    it("should only return services for the specified account", async () => {
      // Given
      const accountId = new ObjectId();
      const otherAccountId = new ObjectId();
      const repositoryId = new ObjectId();
      await repo.create({ accountId, repositoryId, name: "my-service" });
      await repo.create({
        accountId: otherAccountId,
        repositoryId,
        name: "other-service",
      });

      // When
      const services = await repo.findByRepositoryId(accountId, repositoryId);

      // Then
      expect(services).toHaveLength(1);
      expect(services[0].name).toBe("my-service");
    });

    it("should return empty array when no services exist", async () => {
      // When
      const services = await repo.findByRepositoryId(
        new ObjectId(),
        new ObjectId(),
      );

      // Then
      expect(services).toEqual([]);
    });
  });

  describe("updateWorkflowConfiguration", () => {
    it("should update workflow file and event type", async () => {
      // Given: a service exists
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "update-workflow-test",
      });

      // When: I update workflow configuration
      const updated = await repo.updateWorkflowConfiguration(service._id, {
        workflowFile: "deploy-prod.yml",
        eventType: "deploy-prod",
      });

      // Then: workflowFile and eventType are updated
      expect(updated).not.toBeNull();
      expect(updated?.workflowFile).toBe("deploy-prod.yml");
      expect(updated?.eventType).toBe("deploy-prod");
    });

    it("should return null if service not found", async () => {
      // Given: a non-existent service ID
      const fakeId = new ObjectId();

      // When: I update workflow configuration
      const result = await repo.updateWorkflowConfiguration(fakeId, {
        workflowFile: "deploy.yml",
        eventType: "deployment",
      });

      // Then: null is returned
      expect(result).toBeNull();
    });

    it("should only update specified fields", async () => {
      // Given: a service with custom environments
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "partial-update-test",
        environments: [{ name: "dev", displayName: "Dev", order: 0 }],
      });

      // When: I update workflow configuration
      const updated = await repo.updateWorkflowConfiguration(service._id, {
        workflowFile: "new-workflow.yml",
        eventType: "new-event",
      });

      // Then: environments are not changed
      expect(updated?.environments).toEqual([
        { name: "dev", displayName: "Dev", order: 0 },
      ]);
      expect(updated?.name).toBe("partial-update-test");
    });
  });

  describe("ensureIndexes", () => {
    it("should create unique index on accountId, repositoryId, name", async () => {
      // Given
      await repo.ensureIndexes();
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      await repo.create({ accountId, repositoryId, name: "api" });

      // When/Then - creating duplicate should fail
      await expect(
        repo.create({ accountId, repositoryId, name: "api" }),
      ).rejects.toThrow();
    });
  });
});
