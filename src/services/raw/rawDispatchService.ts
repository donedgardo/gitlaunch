import { IHttpClient, HttpClient } from "../github/githubAppClient";
import { UpstreamDispatchError } from "../dispatch/upstreamDispatchError";

export type RawDispatchInput = {
  endpointUrl: string;
  buildId: string;
  environment: string;
};

/**
 * Triggers a deploy by POSTing a fixed JSON body to a customer-supplied
 * webhook. The body shape is not customisable for now.
 */
export class RawDispatchService {
  constructor(private http: IHttpClient = new HttpClient()) {}

  async dispatch(input: RawDispatchInput): Promise<void> {
    const response = await this.http.fetch(input.endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buildId: input.buildId,
        environment: input.environment,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new UpstreamDispatchError(
        "Failed to dispatch raw deploy",
        response.status,
        errorBody,
      );
    }
  }
}
