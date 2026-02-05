import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { EnvironmentService } from "./environmentService";

describe("EnvironmentService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let serviceRepo: ServiceRepository;
  let envService: EnvironmentService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    repoRepo = new RepositoryRepository(db);
    serviceRepo = new ServiceRepository(db);
    envService = new EnvironmentService(serviceRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});
    await db.collection("services").deleteMany({});
  });

  describe("listEnvironments", () => {
    it("should return environments for a service the account owns", async () => {
      // Given: an account with a service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "backend",
      });

      // When: I list environments
      const environments = await envService.listEnvironments(
        account._id,
        service._id,
      );

      // Then: I get the environments
      expect(environments).toHaveLength(2);
      expect(environments[0].name).toBe("staging");
      expect(environments[1].name).toBe("prod");
    });

    it("should throw if account doesn't own the service", async () => {
      // Given: a service owned by another account
      const owner = await accountRepo.create({
        name: "Owner Org",
        slug: "owner-org",
      });
      const other = await accountRepo.create({
        name: "Other Org",
        slug: "other-org",
      });
      const repo = await repoRepo.create({
        accountId: owner._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: owner._id,
        repositoryId: repo._id,
        name: "backend",
      });

      // When/Then: trying to list environments fails
      await expect(
        envService.listEnvironments(other._id, service._id),
      ).rejects.toThrow("Service not found");
    });
  });

  describe("addEnvironment", () => {
    it("should add a new environment", async () => {
      // Given: a service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-add",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 124,
        githubFullName: "org/repo2",
        githubOwner: "org",
        githubRepoName: "repo2",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "frontend",
      });

      // When: I add a new environment
      const result = await envService.addEnvironment(account._id, service._id, {
        name: "dev",
        displayName: "Development",
      });

      // Then: environment is added
      expect(result.environments).toHaveLength(3);
      expect(result.environments).toContainEqual(
        expect.objectContaining({ name: "dev", displayName: "Development" }),
      );
    });

    it("should reject invalid environment name format", async () => {
      // Given: a service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-invalid",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 125,
        githubFullName: "org/repo3",
        githubOwner: "org",
        githubRepoName: "repo3",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "api",
      });

      // When/Then: invalid names are rejected
      await expect(
        envService.addEnvironment(account._id, service._id, {
          name: "Invalid Name",
          displayName: "Invalid",
        }),
      ).rejects.toThrow(
        "Environment name must be lowercase alphanumeric with hyphens",
      );

      await expect(
        envService.addEnvironment(account._id, service._id, {
          name: "has_underscore",
          displayName: "Underscore",
        }),
      ).rejects.toThrow(
        "Environment name must be lowercase alphanumeric with hyphens",
      );
    });

    it("should reject duplicate environment name", async () => {
      // Given: a service with staging environment
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-dup",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 126,
        githubFullName: "org/repo4",
        githubOwner: "org",
        githubRepoName: "repo4",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "worker",
      });

      // When/Then: duplicate name is rejected
      await expect(
        envService.addEnvironment(account._id, service._id, {
          name: "staging",
          displayName: "Another Staging",
        }),
      ).rejects.toThrow("Environment name already exists");
    });

    it("should throw if account doesn't own the service", async () => {
      // Given: a service owned by another account
      const owner = await accountRepo.create({
        name: "Owner Org",
        slug: "owner-org-add",
      });
      const other = await accountRepo.create({
        name: "Other Org",
        slug: "other-org-add",
      });
      const repo = await repoRepo.create({
        accountId: owner._id,
        githubRepoId: 127,
        githubFullName: "org/repo5",
        githubOwner: "org",
        githubRepoName: "repo5",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: owner._id,
        repositoryId: repo._id,
        name: "backend",
      });

      // When/Then: trying to add environment fails
      await expect(
        envService.addEnvironment(other._id, service._id, {
          name: "dev",
          displayName: "Development",
        }),
      ).rejects.toThrow("Service not found");
    });
  });

  describe("updateEnvironment", () => {
    it("should update environment displayName", async () => {
      // Given: a service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-update",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 128,
        githubFullName: "org/repo6",
        githubOwner: "org",
        githubRepoName: "repo6",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "service-update",
      });

      // When: I update displayName
      const result = await envService.updateEnvironment(
        account._id,
        service._id,
        "staging",
        { displayName: "Staging Environment" },
      );

      // Then: displayName is updated
      const env = result.environments.find((e) => e.name === "staging");
      expect(env?.displayName).toBe("Staging Environment");
    });

    it("should throw if environment not found", async () => {
      // Given: a service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-no-env",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 129,
        githubFullName: "org/repo7",
        githubOwner: "org",
        githubRepoName: "repo7",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "service-no-env",
      });

      // When/Then: updating non-existent env fails
      await expect(
        envService.updateEnvironment(account._id, service._id, "nonexistent", {
          displayName: "New Name",
        }),
      ).rejects.toThrow("Environment not found");
    });
  });

  describe("removeEnvironment", () => {
    it("should remove an environment", async () => {
      // Given: a service with 3 environments
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-remove",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 130,
        githubFullName: "org/repo8",
        githubOwner: "org",
        githubRepoName: "repo8",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "service-remove",
        environments: [
          { name: "dev", displayName: "Development", order: 0 },
          { name: "staging", displayName: "Staging", order: 1 },
          { name: "prod", displayName: "Production", order: 2 },
        ],
      });

      // When: I remove staging
      const result = await envService.removeEnvironment(
        account._id,
        service._id,
        "staging",
      );

      // Then: staging is removed
      expect(result.environments).toHaveLength(2);
      expect(
        result.environments.find((e) => e.name === "staging"),
      ).toBeUndefined();
    });

    it("should reject removing the last environment", async () => {
      // Given: a service with only 1 environment
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-last",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 131,
        githubFullName: "org/repo9",
        githubOwner: "org",
        githubRepoName: "repo9",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "service-last",
        environments: [{ name: "prod", displayName: "Production", order: 0 }],
      });

      // When/Then: removing last environment fails
      await expect(
        envService.removeEnvironment(account._id, service._id, "prod"),
      ).rejects.toThrow("Cannot remove the last environment");
    });

    it("should throw if environment not found", async () => {
      // Given: a service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-no-rm",
      });
      const repo = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 132,
        githubFullName: "org/repo10",
        githubOwner: "org",
        githubRepoName: "repo10",
        isPrivate: false,
      });
      const service = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repo._id,
        name: "service-no-rm",
      });

      // When/Then: removing non-existent env fails
      await expect(
        envService.removeEnvironment(account._id, service._id, "nonexistent"),
      ).rejects.toThrow("Environment not found");
    });
  });
});
