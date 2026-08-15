import { IHttpClient, HttpClient } from "../github/githubAppClient";
import { UpstreamDispatchError } from "../dispatch/upstreamDispatchError";

export type JenkinsDispatchInput = {
  baseUrl: string;
  username: string;
  apiToken: string;
  jobName: string;
  buildId: string;
  environment: string;
  serviceId: string;
};

type Crumb = { crumbRequestField: string; crumb: string };

export class JenkinsDispatchService {
  constructor(private http: IHttpClient = new HttpClient()) {}

  async dispatch(input: JenkinsDispatchInput): Promise<void> {
    const base = input.baseUrl.replace(/\/+$/, "");
    const auth =
      "Basic " +
      Buffer.from(`${input.username}:${input.apiToken}`).toString("base64");

    const crumbHeaders = await this.fetchCrumbHeaders(base, auth);

    const body = new URLSearchParams({
      buildId: input.buildId,
      environment: input.environment,
      serviceId: input.serviceId,
    }).toString();

    const response = await this.http.fetch(
      `${base}/job/${encodeURIComponent(input.jobName)}/buildWithParameters`,
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/x-www-form-urlencoded",
          ...crumbHeaders,
        },
        body,
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new UpstreamDispatchError(
        "Failed to dispatch Jenkins build",
        response.status,
        errorBody,
      );
    }
  }

  // Jenkins CSRF protection is optional. When the crumb issuer is disabled the
  // GET returns non-OK; we proceed without a crumb rather than fail.
  private async fetchCrumbHeaders(
    base: string,
    auth: string,
  ): Promise<Record<string, string>> {
    const response = await this.http.fetch(`${base}/crumbIssuer/api/json`, {
      headers: { Authorization: auth },
    });
    if (!response.ok) {
      return {};
    }
    const { crumbRequestField, crumb } = (await response.json()) as Crumb;
    return { [crumbRequestField]: crumb };
  }
}
