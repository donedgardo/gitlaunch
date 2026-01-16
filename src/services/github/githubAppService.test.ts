import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import {
  GitHubAppService,
  GitHubApiClient,
  GitHubRepo,
} from "./githubAppService";
import {
  InstallationTokenService,
  IGitHubAppClient,
  InstallationToken,
} from "./installationTokenService";

// Fake GitHub App client
class FakeGitHubAppClient implements IGitHubAppClient {
  async getInstallationToken(
    _installationId: number,
  ): Promise<InstallationToken> {
    return { token: "ghs_fake", expiresAt: new Date(Date.now() + 3600000) };
  }
}

// Fake GitHub API client
class FakeGitHubApiClient implements GitHubApiClient {
  public reposToReturn: GitHubRepo[] = [
    {
      id: 1,
      name: "repo-1",
      full_name: "org/repo-1",
      private: false,
      owner: { login: "org" },
    },
    {
      id: 2,
      name: "repo-2",
      full_name: "org/repo-2",
      private: true,
      owner: { login: "org" },
    },
  ];

  async listInstallationRepos(_token: string): Promise<GitHubRepo[]> {
    return this.reposToReturn;
  }
}

describe("GitHubAppService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let service: GitHubAppService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    service = new GitHubAppService(accountRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
  });

  describe("linkInstallation", () => {
    it("should link installation ID to account", async () => {
      // Given: an account exists
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });

      // When: I link an installation
      await service.linkInstallation(account._id, 12345);

      // Then: the account has the installation ID
      const updated = await accountRepo.findById(account._id);
      expect(updated?.githubInstallationId).toBe(12345);
    });

    it("should throw error if account not found", async () => {
      // Given: a non-existent account ID
      const fakeAccountId = new (await import("mongodb")).ObjectId();

      // When/Then: linking installation throws error
      await expect(
        service.linkInstallation(fakeAccountId, 12345),
      ).rejects.toThrow("Account not found");
    });
  });

  describe("hasInstallation", () => {
    it("should return true when account has installation", async () => {
      // Given: an account with installation
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      await service.linkInstallation(account._id, 12345);

      // When: I check if it has installation
      const result = await service.hasInstallation(account._id);

      // Then: it returns true
      expect(result).toBe(true);
    });

    it("should return false when account has no installation", async () => {
      // Given: an account without installation
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-2",
      });

      // When: I check if it has installation
      const result = await service.hasInstallation(account._id);

      // Then: it returns false
      expect(result).toBe(false);
    });
  });

  describe("listInstallationRepos", () => {
    it("should return repos from GitHub installation", async () => {
      // Given: an account with installation and a service with fake clients
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-3",
      });
      await accountRepo.updateInstallation(account._id, 12345);

      const fakeAppClient = new FakeGitHubAppClient();
      const fakeApiClient = new FakeGitHubApiClient();
      const tokenService = new InstallationTokenService(fakeAppClient);
      const serviceWithClients = new GitHubAppService(
        accountRepo,
        tokenService,
        fakeApiClient,
      );

      // When: I list repos
      const repos = await serviceWithClients.listInstallationRepos(account._id);

      // Then: I get the repos from GitHub
      expect(repos).toHaveLength(2);
      expect(repos[0].full_name).toBe("org/repo-1");
      expect(repos[1].full_name).toBe("org/repo-2");
    });

    it("should throw error when account has no installation", async () => {
      // Given: an account without installation
      const account = await accountRepo.create({
        name: "No Install",
        slug: "no-install",
      });

      const fakeAppClient = new FakeGitHubAppClient();
      const fakeApiClient = new FakeGitHubApiClient();
      const tokenService = new InstallationTokenService(fakeAppClient);
      const serviceWithClients = new GitHubAppService(
        accountRepo,
        tokenService,
        fakeApiClient,
      );

      // When/Then: listing repos throws error
      await expect(
        serviceWithClients.listInstallationRepos(account._id),
      ).rejects.toThrow("Account does not have a GitHub App installation");
    });
  });
});
