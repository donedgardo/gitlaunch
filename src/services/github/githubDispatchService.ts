import { InstallationTokenService } from "./installationTokenService";
import { IHttpClient, HttpClient } from "./githubAppClient";

export type DispatchInput = {
  installationId: number;
  owner: string;
  repo: string;
  workflowFile: string;
  buildId: string;
  environment: string;
  serviceId: string;
};

export class MultiTenantGithubDispatchService {
  constructor(
    private tokenService: InstallationTokenService,
    private http: IHttpClient = new HttpClient(),
  ) {}

  async dispatch(input: DispatchInput): Promise<void> {
    const { token } = await this.tokenService.getToken(input.installationId);

    const response = await this.http.fetch(
      `https://api.github.com/repos/${input.owner}/${input.repo}/actions/workflows/${input.workflowFile}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            environment: input.environment,
            buildId: input.buildId,
            serviceId: input.serviceId,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to dispatch workflow: ${response.status} - ${errorBody}`,
      );
    }
  }
}
