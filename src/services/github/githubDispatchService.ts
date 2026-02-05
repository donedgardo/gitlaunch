import { InstallationTokenService } from "./installationTokenService";
import { IHttpClient, HttpClient } from "./githubAppClient";

export type DispatchInput = {
  installationId: number;
  owner: string;
  repo: string;
  eventType: string;
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
      `https://api.github.com/repos/${input.owner}/${input.repo}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: input.eventType,
          client_payload: {
            env: input.environment,
            "build-id": input.buildId,
            "service-id": input.serviceId,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to dispatch workflow: ${response.status}`);
    }
  }
}
