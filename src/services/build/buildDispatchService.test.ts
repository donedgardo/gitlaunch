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
import { AccountRepository } from "../../repositories/accountRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import {
  BuildDispatchService,
  NoOpBuildDispatchService,
} from "./buildDispatchService";
import { MultiTenantGithubDispatchService } from "../github/githubDispatchService";

describe("BuildDispatchService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let serviceRepo: ServiceRepository;
  let mockGithubDispatch: MultiTenantGithubDispatchService;
  let service: BuildDispatchService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    repoRepo = new RepositoryRepository(db);
    serviceRepo = new ServiceRepository(db);

    mockGithubDispatch = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as MultiTenantGithubDispatchService;

    service = new BuildDispatchService(
      accountRepo,
      repoRepo,
      serviceRepo,
      mockGithubDispatch,
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
    vi.clearAllMocks();
  });

  describe("dispatch", () => {
    it("should call GitHub dispatch with correct parameters", async () => {
      // Given: an account with GitHub installation, a repository, and a service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      await accountRepo.updateInstallation(account._id, 12345);

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
        workflowFile: "deploy-backend.yml",
      });

      // When: I dispatch a deployment
      await service.dispatch(account._id, svc._id, "build-123", "staging");

      // Then: GitHub dispatch is called with correct parameters
      expect(mockGithubDispatch.dispatch).toHaveBeenCalledWith({
        installationId: 12345,
        owner: "org",
        repo: "repo",
        workflowFile: "deploy-backend.yml",
        buildId: "build-123",
        environment: "staging",
        serviceId: svc._id.toString(),
      });
    });

    it("should throw when account not found", async () => {
      // Given: a non-existent account ID
      const nonExistentAccountId = new ObjectId();
      const nonExistentServiceId = new ObjectId();

      // When/Then: dispatch should throw
      await expect(
        service.dispatch(
          nonExistentAccountId,
          nonExistentServiceId,
          "build-123",
          "staging",
        ),
      ).rejects.toThrow("Account not found");
    });

    it("should throw when GitHub App not installed", async () => {
      // Given: an account without GitHub installation
      const account = await accountRepo.create({
        name: "No GitHub",
        slug: "no-github",
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

      // When/Then: dispatch should throw
      await expect(
        service.dispatch(account._id, svc._id, "build-123", "staging"),
      ).rejects.toThrow("GitHub App not installed for this account");
    });

    it("should throw when service not found", async () => {
      // Given: an account with GitHub installation but non-existent service
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-no-service",
      });
      await accountRepo.updateInstallation(account._id, 12345);
      const nonExistentServiceId = new ObjectId();

      // When/Then: dispatch should throw
      await expect(
        service.dispatch(
          account._id,
          nonExistentServiceId,
          "build-123",
          "staging",
        ),
      ).rejects.toThrow("Service not found");
    });
  });
});

describe("NoOpBuildDispatchService", () => {
  it("should not throw when dispatching", async () => {
    // Given: a no-op dispatcher
    const service = new NoOpBuildDispatchService();

    // When/Then: dispatch should not throw
    await expect(
      service.dispatch(new ObjectId(), new ObjectId(), "build-123", "staging"),
    ).resolves.toBeUndefined();
  });
});
