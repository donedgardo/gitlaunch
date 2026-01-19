import { IGitHubApiClient, GitHubRepo } from "./githubAppService";

export interface IHttpClient {
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

class HttpClient implements IHttpClient {
  fetch(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, options);
  }
}

type GitHubReposResponse = {
  repositories: GitHubRepo[];
};

export class GitHubApiClient implements IGitHubApiClient {
  constructor(private http: IHttpClient = new HttpClient()) {}

  async listInstallationRepos(token: string): Promise<GitHubRepo[]> {
    const response = await this.http.fetch(
      "https://api.github.com/installation/repositories",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to list repos: ${response.status}`);
    }

    const data = (await response.json()) as GitHubReposResponse;
    return data.repositories;
  }
}
