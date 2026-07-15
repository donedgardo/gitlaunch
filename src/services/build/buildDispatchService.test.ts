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
import { GithubProviderDispatcher } from "../github/githubProviderDispatcher";
import { JenkinsConnectionService } from "../jenkins/jenkinsConnectionService";
import { JenkinsDispatchService } from "../jenkins/jenkinsDispatchService";
import { JenkinsProviderDispatcher } from "../jenkins/jenkinsProviderDispatcher";

describe("BuildDispatchService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let repoRepo: RepositoryRepository;
  let serviceRepo: ServiceRepository;
  let mockGithubDispatch: MultiTenantGithubDispatchService;
  let mockJenkinsDispatch: JenkinsDispatchService;
  let jenkinsConnectionService: JenkinsConnectionService;
  let service: BuildDispatchService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    repoRepo = new RepositoryRepository(db);
    serviceRepo = new ServiceRepository(db);
    jenkinsConnectionService = new JenkinsConnectionService(accountRepo);

    mockGithubDispatch = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as MultiTenantGithubDispatchService;

    mockJenkinsDispatch = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as JenkinsDispatchService;

    service = new BuildDispatchService(accountRepo, serviceRepo, [
      new GithubProviderDispatcher(repoRepo, mockGithubDispatch),
      new JenkinsProviderDispatcher(
        jenkinsConnectionService,
        mockJenkinsDispatch,
      ),
    ]);
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

    it("should dispatch to Jenkins for a jenkins-provider service", async () => {
      // Given: an account with a connected Jenkins server (no GitHub install)
      const account = await accountRepo.create({
        name: "Jenkins Org",
        slug: "jenkins-org",
      });
      await jenkinsConnectionService.connect({
        accountId: account._id,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: "secret-token",
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
      await serviceRepo.setProvider(account._id, svc._id, {
        ciProvider: "jenkins",
        jobName: "deploy-backend",
      });

      // When: I dispatch a deployment
      await service.dispatch(account._id, svc._id, "build-123", "staging");

      // Then: Jenkins is dispatched with the decrypted token, not GitHub
      expect(mockJenkinsDispatch.dispatch).toHaveBeenCalledWith({
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: "secret-token",
        jobName: "deploy-backend",
        buildId: "build-123",
        environment: "staging",
        serviceId: svc._id.toString(),
      });
      expect(mockGithubDispatch.dispatch).not.toHaveBeenCalled();
    });

    it("should throw when the Jenkins service has no connection", async () => {
      const account = await accountRepo.create({
        name: "No Jenkins",
        slug: "no-jenkins-conn",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 1,
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
      await serviceRepo.setProvider(account._id, svc._id, {
        ciProvider: "jenkins",
        jobName: "deploy-backend",
      });

      await expect(
        service.dispatch(account._id, svc._id, "build-123", "staging"),
      ).rejects.toThrow("Jenkins is not connected for this account");
      expect(mockJenkinsDispatch.dispatch).not.toHaveBeenCalled();
    });

    it("should throw when the Jenkins service has no job name", async () => {
      const account = await accountRepo.create({
        name: "No Job",
        slug: "no-job",
      });
      await jenkinsConnectionService.connect({
        accountId: account._id,
        baseUrl: "https://ci.acme.com",
        username: "deploy-bot",
        apiToken: "secret-token",
      });
      const repository = await repoRepo.create({
        accountId: account._id,
        githubRepoId: 1,
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
      // Provider set to jenkins but jobName left null
      await serviceRepo.setProvider(account._id, svc._id, {
        ciProvider: "jenkins",
        jobName: null,
      });

      await expect(
        service.dispatch(account._id, svc._id, "build-123", "staging"),
      ).rejects.toThrow("Jenkins job name is not configured for this service");
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
