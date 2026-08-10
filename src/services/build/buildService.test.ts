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
import { ServiceRepository } from "../../repositories/serviceRepository";
import { BuildRepository } from "../../repositories/buildRepository";
import { BuildService } from "./buildService";
import { DeploymentStatus } from "../service/deploymentStatus";
import { BuildDispatchServiceI } from "./buildDispatchService";

describe("BuildService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let serviceRepo: ServiceRepository;
  let buildRepo: BuildRepository;
  let eventEmitter: EventEmitter;
  let mockDispatcher: BuildDispatchServiceI;
  let service: BuildService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    repoRepo = new RepositoryRepository(db);
    serviceRepo = new ServiceRepository(db);
    buildRepo = new BuildRepository(db);
    eventEmitter = new EventEmitter();
    mockDispatcher = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    };
    service = new BuildService(
      buildRepo,
      serviceRepo,
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
    await db.collection("services").deleteMany({});
    await db.collection("builds").deleteMany({});
    vi.clearAllMocks();
  });

  describe("createBuild", () => {
    it("should create build when service belongs to account", async () => {
      // Given: an account with a repository and service
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
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend",
      });

      // When: I create a build
      const build = await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "abc123",
      });

      // Then: the build is created
      expect(build._id).toBeDefined();
      expect(build.buildId).toBe("abc123");
      expect(build.accountId.toString()).toBe(account._id.toString());
      expect(build.serviceId.toString()).toBe(svc._id.toString());
    });

    it("should carry the commit message through to the created build", async () => {
      // Given: an account with a repository and service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-msg",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 555,
        githubFullName: "org/repo-msg",
        githubOwner: "org",
        githubRepoName: "repo-msg",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend-msg",
      });

      // When: I create a build with a commit message
      const build = await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "abc123",
        message: "Add shareable team invite links",
      });

      // Then: the message is stored on the build
      expect(build.message).toBe("Add shareable team invite links");
    });

    it("should include the commit message on the build:created event", async () => {
      // Given: an account with a repository and service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-msg-event",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 556,
        githubFullName: "org/repo-msg-event",
        githubOwner: "org",
        githubRepoName: "repo-msg-event",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend-msg-event",
      });

      const eventReceived = vi.fn();
      eventEmitter.on("build:created", eventReceived);

      // When: I create a build with a commit message
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "msg-event-1",
        message: "Fix session cookie expiry",
      });

      // Then: the event carries the message so a live-inserted row can show it
      expect(eventReceived).toHaveBeenCalledWith(
        expect.objectContaining({
          buildId: "msg-event-1",
          message: "Fix session cookie expiry",
        }),
      );
    });

    it("should reject when service does not exist", async () => {
      // Given: an account but no service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-no-service",
      });
      const nonExistentServiceId = new ObjectId();

      // When/Then: creating a build should throw
      await expect(
        service.createBuild({
          accountId: account._id,
          serviceId: nonExistentServiceId,
          buildId: "abc123",
        }),
      ).rejects.toThrow("Service not found");
    });

    it("should emit build:created event when build is created", async () => {
      // Given: an account with a repository and service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-event",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 999,
        githubFullName: "org/repo-event",
        githubOwner: "org",
        githubRepoName: "repo-event",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "event-service",
      });

      const eventReceived = vi.fn();
      eventEmitter.on("build:created", eventReceived);

      // When: I create a build
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "new-build-123",
      });

      // Then: build:created event is emitted with service info
      expect(eventReceived).toHaveBeenCalledWith(
        expect.objectContaining({
          buildId: "new-build-123",
          serviceId: svc._id.toString(),
          serviceName: "event-service",
        }),
      );
    });

    it("should reject when service belongs to different account", async () => {
      // Given: two accounts and a service belonging to account A
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
      const svc = await serviceRepo.create({
        accountId: accountA._id,
        repositoryId: repository._id,
        name: "api",
      });

      // When/Then: account B tries to create a build for account A's service
      await expect(
        service.createBuild({
          accountId: accountB._id,
          serviceId: svc._id,
          buildId: "abc123",
        }),
      ).rejects.toThrow("Service does not belong to this account");
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
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "find-me",
      });

      // When: I get the build
      const build = await service.getBuild(account._id, svc._id, "find-me");

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
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend",
      });

      // When: I get a non-existent build
      const build = await service.getBuild(
        account._id,
        svc._id,
        "non-existent",
      );

      // Then: I get null
      expect(build).toBeNull();
    });
  });

  describe("getBuilds", () => {
    it("should return builds for account and service", async () => {
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
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-1",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-2",
      });

      // When: I list builds
      const builds = await service.getBuilds(account._id, svc._id);

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
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "deploy-me",
      });

      // When: I update deployment status
      const build = await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
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
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "invalid-env-build",
      });

      // When/Then: updating with invalid env should throw
      await expect(
        service.updateDeploymentStatus({
          accountId: account._id,
          serviceId: svc._id,
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
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "invalid-status-build",
      });

      // When/Then: updating with invalid status should throw
      await expect(
        service.updateDeploymentStatus({
          accountId: account._id,
          serviceId: svc._id,
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
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "dispatch-me",
      });

      // When: I update status to DISPATCHING
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "dispatch-me",
        environment: "staging",
        status: DeploymentStatus.DISPATCHING,
      });

      // Then: dispatch is called with full context
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        account._id,
        svc._id,
        "dispatch-me",
        "staging",
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
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "event-build",
      });

      const eventReceived = vi.fn();
      eventEmitter.on("build:update", eventReceived);

      // When: I update deployment status
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "event-build",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });

      // Then: event is emitted as array with expected properties
      expect(eventReceived).toHaveBeenCalledWith([
        expect.objectContaining({
          buildId: "event-build",
          environment: "staging",
          status: DeploymentStatus.DEPLOYED,
          serviceId: svc._id.toString(),
        }),
      ]);
    });

    it("should emit build:update event as array with serviceName for SSE listener", async () => {
      // Given: a build exists and event listener is registered
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-sse-event",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 456,
        githubFullName: "org/sse-repo",
        githubOwner: "org",
        githubRepoName: "sse-repo",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "api-service",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "sse-build",
      });

      const eventReceived = vi.fn();
      eventEmitter.on("build:update", eventReceived);

      // When: I update deployment status
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "sse-build",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });

      // Then: event is emitted as an ARRAY (for SSE listener compatibility)
      expect(eventReceived).toHaveBeenCalledTimes(1);
      const emittedPayload = eventReceived.mock.calls[0][0];

      // SSE listener expects an array
      expect(Array.isArray(emittedPayload)).toBe(true);
      expect(emittedPayload).toHaveLength(1);

      // Each event must have serviceName (not just serviceId) for SSE template
      expect(emittedPayload[0]).toEqual(
        expect.objectContaining({
          buildId: "sse-build",
          environment: "staging",
          status: DeploymentStatus.DEPLOYED,
          serviceId: svc._id.toString(),
          serviceName: "api-service",
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
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "backend",
      });

      // When/Then: updating non-existent build should throw
      await expect(
        service.updateDeploymentStatus({
          accountId: account._id,
          serviceId: svc._id,
          buildId: "non-existent",
          environment: "staging",
          status: DeploymentStatus.DEPLOYED,
        }),
      ).rejects.toThrow("Build not found");
    });

    it("should mark workflow as configured on first deployment status update", async () => {
      // Given: a service with workflowConfigured=false and a build
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-auto-config",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 789,
        githubFullName: "org/auto-config-repo",
        githubOwner: "org",
        githubRepoName: "auto-config-repo",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "auto-config-service",
      });
      expect(svc.workflowConfigured).toBe(false);

      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "auto-config-build",
      });

      // When: I update deployment status
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "auto-config-build",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });

      // Then: workflowConfigured is set to true
      const updatedService = await serviceRepo.findById(svc._id);
      expect(updatedService?.workflowConfigured).toBe(true);
    });

    it("should clear other builds' deployment status when a build is deployed", async () => {
      // Given: two builds, build A deployed to staging
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-clear-others",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 555,
        githubFullName: "org/clear-repo",
        githubOwner: "org",
        githubRepoName: "clear-repo",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "clear-service",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-a",
      });
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-a",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-b",
      });

      // When: build B is deployed to staging
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-b",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });

      // Then: build A's staging status is cleared to NONE
      const buildA = await service.getBuild(account._id, svc._id, "build-a");
      expect(buildA!.deployments["staging"]).toBe(DeploymentStatus.NONE);
    });

    it("should emit SSE events for cleared builds when a build is deployed", async () => {
      // Given: build A deployed to staging
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-sse-clear",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 666,
        githubFullName: "org/sse-clear-repo",
        githubOwner: "org",
        githubRepoName: "sse-clear-repo",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "sse-clear-service",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-a",
      });
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-a",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-b",
      });

      const eventReceived = vi.fn();
      eventEmitter.on("build:update", eventReceived);

      // When: build B is deployed to staging
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-b",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });

      // Then: SSE event array includes both the deployed build and the cleared build
      expect(eventReceived).toHaveBeenCalledTimes(1);
      const emittedPayload = eventReceived.mock.calls[0][0];
      expect(Array.isArray(emittedPayload)).toBe(true);
      expect(emittedPayload).toHaveLength(2);

      // The deployed build event
      expect(emittedPayload).toContainEqual(
        expect.objectContaining({
          buildId: "build-b",
          environment: "staging",
          status: DeploymentStatus.DEPLOYED,
        }),
      );
      // The cleared build event
      expect(emittedPayload).toContainEqual(
        expect.objectContaining({
          buildId: "build-a",
          environment: "staging",
          status: DeploymentStatus.NONE,
        }),
      );
    });

    it("should not clear other builds for non-DEPLOYED statuses", async () => {
      // Given: build A deployed to staging
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-no-clear",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 777,
        githubFullName: "org/no-clear-repo",
        githubOwner: "org",
        githubRepoName: "no-clear-repo",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "no-clear-service",
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-a",
      });
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-a",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-b",
      });

      // When: build B is set to DEPLOYING (not DEPLOYED)
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "build-b",
        environment: "staging",
        status: DeploymentStatus.DEPLOYING,
      });

      // Then: build A's staging status is still DEPLOYED
      const buildA = await service.getBuild(account._id, svc._id, "build-a");
      expect(buildA!.deployments["staging"]).toBe(DeploymentStatus.DEPLOYED);
    });

    it("should not update workflowConfigured if already true", async () => {
      // Given: a service with workflowConfigured=true
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-already-configured",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 999,
        githubFullName: "org/already-configured-repo",
        githubOwner: "org",
        githubRepoName: "already-configured-repo",
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: "already-configured-service",
      });
      // Manually set workflowConfigured to true via updateWorkflowConfiguration
      await serviceRepo.updateWorkflowConfiguration(svc._id, {
        workflowFile: "deploy.yml",
      });
      const configuredService = await serviceRepo.findById(svc._id);
      expect(configuredService?.workflowConfigured).toBe(true);

      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "already-configured-build",
      });

      // When: I update deployment status (workflow already configured)
      await service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "already-configured-build",
        environment: "staging",
        status: DeploymentStatus.DEPLOYED,
      });

      // Then: service still has workflowConfigured=true (no error, idempotent)
      const finalService = await serviceRepo.findById(svc._id);
      expect(finalService?.workflowConfigured).toBe(true);
    });
  });

  describe("deployment intent", () => {
    const setup = async (slug: string) => {
      const account = await accountRepo.create({ name: "Org", slug });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: Math.floor(Math.random() * 1e6),
        githubFullName: `org/${slug}`,
        githubOwner: "org",
        githubRepoName: slug,
        isPrivate: false,
      });
      const svc = await serviceRepo.create({
        accountId: account._id,
        repositoryId: repository._id,
        name: slug,
      });
      return { account, svc };
    };

    const deploy = async (
      account: { _id: ObjectId },
      svc: { _id: ObjectId },
      buildId: string,
      status: DeploymentStatus,
    ) =>
      service.updateDeploymentStatus({
        accountId: account._id,
        serviceId: svc._id,
        buildId,
        environment: "prod",
        status,
      });

    const logsFor = async (
      account: { _id: ObjectId },
      svc: { _id: ObjectId },
      buildId: string,
    ) => {
      const build = await buildRepo.findByBuildId(
        account._id,
        svc._id,
        buildId,
      );
      return build!.deploymentLogs.filter((l) => l.environment === "prod");
    };

    it("should record a promote when a newer build goes out", async () => {
      // Given: an older build is live in prod
      const { account, svc } = await setup("promote-org");
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "v1",
      });
      await deploy(account, svc, "v1", DeploymentStatus.DEPLOYED);

      // When: a newer build is dispatched there
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "v2",
      });
      await deploy(account, svc, "v2", DeploymentStatus.DISPATCHING);

      // Then: it is recorded as moving forward
      const logs = await logsFor(account, svc, "v2");
      expect(logs[0].intent).toBe("promote");
    });

    it("should record a rollback when an older build is sent back out", async () => {
      // Given: v1 then v2 have both been live in prod
      const { account, svc } = await setup("rollback-org");
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "v1",
      });
      await deploy(account, svc, "v1", DeploymentStatus.DEPLOYED);
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "v2",
      });
      await deploy(account, svc, "v2", DeploymentStatus.DEPLOYED);

      // When: the team sends v1 back out
      await deploy(account, svc, "v1", DeploymentStatus.DISPATCHING);

      // Then: it is recorded as an undo — the signal change failure rate and
      // time to restore are both counted from
      const logs = await logsFor(account, svc, "v1");
      expect(logs[logs.length - 1].intent).toBe("rollback");
    });

    it("should keep the rollback intent on the status updates that follow", async () => {
      // Given: a rollback of v1 has been dispatched
      const { account, svc } = await setup("carry-org");
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "v1",
      });
      await deploy(account, svc, "v1", DeploymentStatus.DEPLOYED);
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "v2",
      });
      await deploy(account, svc, "v2", DeploymentStatus.DEPLOYED);
      await deploy(account, svc, "v1", DeploymentStatus.DISPATCHING);

      // When: the pipeline reports it landed
      await deploy(account, svc, "v1", DeploymentStatus.DEPLOYED);

      // Then: the entry that marks service restored is a rollback too
      const logs = await logsFor(account, svc, "v1");
      const last = logs[logs.length - 1];
      expect(last.status).toBe(DeploymentStatus.DEPLOYED);
      expect(last.intent).toBe("rollback");
    });

    it("should record a promote for the first ever deploy to an environment", async () => {
      // Given: nothing has been deployed to prod
      const { account, svc } = await setup("first-org");
      await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "v1",
      });

      // When: the first build is dispatched
      await deploy(account, svc, "v1", DeploymentStatus.DISPATCHING);

      // Then: there is nothing to undo
      const logs = await logsFor(account, svc, "v1");
      expect(logs[0].intent).toBe("promote");
    });
  });
});
