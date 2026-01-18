import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import EventEmitter from "node:events";
import { AccountRepository } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { BuildRepository } from "../../repositories/buildRepository";
import { BuildService } from "./buildService";
import { DeploymentStatus } from "../service/deploymentStatus";
import { IDispatchService } from "../service/IDispatchService";

describe("BuildService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let buildRepo: BuildRepository;
  let eventEmitter: EventEmitter;
  let mockDispatcher: IDispatchService;
  let service: BuildService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    repoRepo = new RepositoryRepository(db);
    buildRepo = new BuildRepository(db);
    eventEmitter = new EventEmitter();
    mockDispatcher = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    };
    service = new BuildService(
      buildRepo,
      repoRepo,
      eventEmitter,
      mockDispatcher,
    );
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("repositories").deleteMany({});
    await db.collection("builds").deleteMany({});
    vi.clearAllMocks();
  });

  describe("createBuild", () => {
    it("should create build when repository belongs to account", async () => {
      // Given: an account with a repository
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });

      // When: I create a build
      const build = await service.createBuild({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "abc123",
      });

      // Then: the build is created
      expect(build._id).toBeDefined();
      expect(build.buildId).toBe("abc123");
      expect(build.accountId.toString()).toBe(account._id.toString());
      expect(build.repositoryId.toString()).toBe(repository._id.toString());
    });

    it("should reject when repository does not exist", async () => {
      // Given: an account but no repository
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-no-repo",
      });
      const nonExistentRepoId = new ObjectId();

      // When/Then: creating a build should throw
      await expect(
        service.createBuild({
          accountId: account._id,
          repositoryId: nonExistentRepoId,
          buildId: "abc123",
        }),
      ).rejects.toThrow("Repository not found");
    });

    it("should reject when repository belongs to different account", async () => {
      // Given: two accounts and a repo belonging to account A
      const accountA = await accountRepo.create({
        name: "Account A",
        slug: "account-a",
      });
      const accountB = await accountRepo.create({
        name: "Account B",
        slug: "account-b",
      });
      const repository = await repoRepo.create({
        accountId: accountA._id,
        githubRepoId: 123,
        githubFullName: "org-a/repo",
        githubOwner: "org-a",
        githubRepoName: "repo",
        isPrivate: false,
      });

      // When/Then: account B tries to create a build for account A's repo
      await expect(
        service.createBuild({
          accountId: accountB._id,
          repositoryId: repository._id,
          buildId: "abc123",
        }),
      ).rejects.toThrow("Repository does not belong to this account");
    });
  });

  describe("getBuild", () => {
    it("should return build when found", async () => {
      // Given: a build exists
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-get",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });
      await service.createBuild({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "find-me",
      });

      // When: I get the build
      const build = await service.getBuild(
        account._id,
        repository._id,
        "find-me",
      );

      // Then: I get the build
      expect(build).not.toBeNull();
      expect(build!.buildId).toBe("find-me");
    });

    it("should return null when build not found", async () => {
      // Given: no matching build
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-not-found",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });

      // When: I get a non-existent build
      const build = await service.getBuild(
        account._id,
        repository._id,
        "non-existent",
      );

      // Then: I get null
      expect(build).toBeNull();
    });
  });

  describe("getBuilds", () => {
    it("should return builds for account and repository", async () => {
      // Given: multiple builds exist
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-list",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });
      await service.createBuild({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "build-1",
      });
      await service.createBuild({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "build-2",
      });

      // When: I list builds
      const builds = await service.getBuilds(account._id, repository._id);

      // Then: I get all builds
      expect(builds).toHaveLength(2);
    });
  });

  describe("updateDeploymentStatus", () => {
    it("should update deployment status", async () => {
      // Given: a build exists
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-update",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });
      await service.createBuild({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "deploy-me",
      });

      // When: I update deployment status
      const build = await service.updateDeploymentStatus({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "deploy-me",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });

      // Then: the status is updated
      expect(build.deployments["staging"]).toBe(DeploymentStatus.DEPLOYED);
    });

    it("should reject invalid environment", async () => {
      // Given: a build exists with default environments (staging, prod)
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-invalid-env",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });
      await service.createBuild({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "invalid-env-build",
      });

      // When/Then: updating with invalid env should throw
      await expect(
        service.updateDeploymentStatus({
          accountId: account._id,
          repositoryId: repository._id,
          buildId: "invalid-env-build",
          environment: "invalid-env",
          status: DeploymentStatus.DEPLOYED,
        }),
      ).rejects.toThrow("Invalid environment");
    });

    it("should reject invalid deployment status", async () => {
      // Given: a build exists
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-invalid-status",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });
      await service.createBuild({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "invalid-status-build",
      });

      // When/Then: updating with invalid status should throw
      await expect(
        service.updateDeploymentStatus({
          accountId: account._id,
          repositoryId: repository._id,
          buildId: "invalid-status-build",
          environment: "staging",
          status: "invalid-status" as DeploymentStatus,
        }),
      ).rejects.toThrow("Invalid deployment status");
    });

    it("should trigger dispatch when status is DISPATCHING", async () => {
      // Given: a build exists
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-dispatch",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });
      await service.createBuild({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "dispatch-me",
      });

      // When: I update status to DISPATCHING
      await service.updateDeploymentStatus({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "dispatch-me",
        environment: "staging",
        status: DeploymentStatus.DISPATCHING,
      });

      // Then: dispatch is called
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        "staging",
        "dispatch-me",
      );
    });

    it("should emit build:update event", async () => {
      // Given: a build exists and event listener is registered
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-event",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });
      await service.createBuild({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "event-build",
      });

      const eventReceived = vi.fn();
      eventEmitter.on("build:update", eventReceived);

      // When: I update deployment status
      await service.updateDeploymentStatus({
        accountId: account._id,
        repositoryId: repository._id,
        buildId: "event-build",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });

      // Then: event is emitted
      expect(eventReceived).toHaveBeenCalledWith(
        expect.objectContaining({
          buildId: "event-build",
          environment: "staging",
          status: DeploymentStatus.DEPLOYED,
          repositoryId: repository._id.toString(),
        }),
      );
    });

    it("should reject when build not found", async () => {
      // Given: no build exists
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-not-found-update",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 123,
        githubFullName: "org/repo",
        githubOwner: "org",
        githubRepoName: "repo",
        isPrivate: false,
      });

      // When/Then: updating non-existent build should throw
      await expect(
        service.updateDeploymentStatus({
          accountId: account._id,
          repositoryId: repository._id,
          buildId: "non-existent",
          environment: "staging",
          status: DeploymentStatus.DEPLOYED,
        }),
      ).rejects.toThrow("Build not found");
    });
  });
});
