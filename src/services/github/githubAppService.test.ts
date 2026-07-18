import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import {
  GitHubAppService,
  IGitHubApiClient,
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

import { GitHubWorkflow } from "./githubAppService";

// Fake GitHub API client
class FakeGitHubApiClient implements IGitHubApiClient {
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

  public workflowsToReturn: GitHubWorkflow[] = [
    { id: 1, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
    {
      id: 2,
      name: "Deploy",
      path: ".github/workflows/deploy.yml",
      state: "active",
    },
  ];

  async listInstallationRepos(_token: string): Promise<GitHubRepo[]> {
    return this.reposToReturn;
  }

  async listWorkflows(
    _token: string,
    _owner: string,
    _repo: string,
  ): Promise<GitHubWorkflow[]> {
    return this.workflowsToReturn;
  }
}

describe("GitHubAppService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
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

  describe("listRepositoryWorkflows", () => {
    it("should return workflows for a repository", async () => {
      // Given: an account with GitHub installation
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-workflows",
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

      // When: I list workflows for a repo
      const workflows = await serviceWithClients.listRepositoryWorkflows(
        account._id,
        "org",
        "repo-1",
      );

      // Then: workflows are returned
      expect(workflows).toHaveLength(2);
      expect(workflows[0].name).toBe("CI");
      expect(workflows[1].name).toBe("Deploy");
    });

    it("should throw error when account has no installation", async () => {
      // Given: an account without installation
      const account = await accountRepo.create({
        name: "No Install Workflows",
        slug: "no-install-workflows",
      });

      const fakeAppClient = new FakeGitHubAppClient();
      const fakeApiClient = new FakeGitHubApiClient();
      const tokenService = new InstallationTokenService(fakeAppClient);
      const serviceWithClients = new GitHubAppService(
        accountRepo,
        tokenService,
        fakeApiClient,
      );

      // When/Then: listing workflows throws error
      await expect(
        serviceWithClients.listRepositoryWorkflows(account._id, "org", "repo"),
      ).rejects.toThrow("Account does not have a GitHub App installation");
    });
  });
});
