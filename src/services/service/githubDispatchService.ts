import { IDispatchService } from "./IDispatchService";

export class GithubDispatchService implements IDispatchService {
  private readonly serviceName: string;
  private readonly accessToken: string;
  private readonly githubOrg: string;
  constructor(serviceName: string, accessToken: string, githubOrg: string) {
    this.serviceName = serviceName;
    this.accessToken = accessToken;
    this.githubOrg = githubOrg;
  }
  async dispatch(env: string, buildId: string): Promise<void> {
    await fetch(
      `https://api.github.com/repos/${this.githubOrg}/${this.serviceName}/dispatches`,
      {
        method: "POST",
        body: JSON.stringify({
          event_type: "deployment",
          client_payload: { env, "build-id": buildId },
        }),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.accessToken}`,
        },
      },
    );
  }
}
