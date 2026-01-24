import { describe, it, expect, beforeEach } from "vitest";
import { GitHubApiClient, IHttpClient } from "./githubApiClient";

// Fake HTTP client
class FakeHttpClient implements IHttpClient {
  public lastRequest: { url: string; options: RequestInit } | null = null;
  public responseToReturn = {
    repositories: [
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
    ],
  };

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    this.lastRequest = { url, options: options ?? {} };
    return new Response(JSON.stringify(this.responseToReturn), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

describe("GitHubApiClient", () => {
  let fakeHttp: FakeHttpClient;
  let client: GitHubApiClient;

  describe("listWorkflows", () => {
    beforeEach(() => {
      fakeHttp = new FakeHttpClient();
      client = new GitHubApiClient(fakeHttp);
    });

    it("should return workflows from GitHub repository", async () => {
      // Given: a repository with workflows
      fakeHttp.responseToReturn = {
        workflows: [
          {
            id: 123,
            name: "CI",
            path: ".github/workflows/ci.yml",
            state: "active",
          },
          {
            id: 456,
            name: "Deploy",
            path: ".github/workflows/deploy.yml",
            state: "active",
          },
        ],
      } as any;

      // When: I list workflows
      const workflows = await client.listWorkflows(
        "ghs_token123",
        "owner",
        "repo",
      );

      // Then: workflows are returned with name, path, state
      expect(workflows).toHaveLength(2);
      expect(workflows[0]).toEqual({
        id: 123,
        name: "CI",
        path: ".github/workflows/ci.yml",
        state: "active",
      });
      expect(workflows[1]).toEqual({
        id: 456,
        name: "Deploy",
        path: ".github/workflows/deploy.yml",
        state: "active",
      });
    });

    it("should call correct GitHub API endpoint", async () => {
      // Given: a mock response
      fakeHttp.responseToReturn = { workflows: [] } as any;

      // When: I list workflows
      await client.listWorkflows("ghs_token123", "owner", "repo");

      // Then: correct endpoint was called
      expect(fakeHttp.lastRequest?.url).toBe(
        "https://api.github.com/repos/owner/repo/actions/workflows",
      );
    });

    it("should use token in Authorization header", async () => {
      // Given: a mock response
      fakeHttp.responseToReturn = { workflows: [] } as any;

      // When: I list workflows
      await client.listWorkflows("ghs_token123", "owner", "repo");

      // Then: token is in header
      const headers = fakeHttp.lastRequest?.options?.headers as Record<
        string,
        string
      >;
      expect(headers["Authorization"]).toBe("Bearer ghs_token123");
    });
  });

  beforeEach(() => {
    fakeHttp = new FakeHttpClient();
    client = new GitHubApiClient(fakeHttp);
  });

  describe("listInstallationRepos", () => {
    it("should call correct GitHub API endpoint", async () => {
      // When: I list repos
      await client.listInstallationRepos("ghs_token123");

      // Then: correct endpoint was called
      expect(fakeHttp.lastRequest?.url).toBe(
        "https://api.github.com/installation/repositories",
      );
    });

    it("should use token in Authorization header", async () => {
      // When: I list repos
      await client.listInstallationRepos("ghs_token123");

      // Then: token is in header
      const headers = fakeHttp.lastRequest?.options?.headers as Record<
        string,
        string
      >;
      expect(headers["Authorization"]).toBe("Bearer ghs_token123");
    });

    it("should return repos from response", async () => {
      // When: I list repos
      const repos = await client.listInstallationRepos("ghs_token123");

      // Then: repos are returned
      expect(repos).toHaveLength(2);
      expect(repos[0].full_name).toBe("org/repo-1");
      expect(repos[1].full_name).toBe("org/repo-2");
    });
  });
});
