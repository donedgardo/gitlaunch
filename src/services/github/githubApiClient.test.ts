import { describe, it, expect, beforeEach } from "vitest";
import { RealGitHubApiClient, HttpClient } from "./githubApiClient";

// Fake HTTP client
class FakeHttpClient implements HttpClient {
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

describe("RealGitHubApiClient", () => {
  let fakeHttp: FakeHttpClient;
  let client: RealGitHubApiClient;

  beforeEach(() => {
    fakeHttp = new FakeHttpClient();
    client = new RealGitHubApiClient(fakeHttp);
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
