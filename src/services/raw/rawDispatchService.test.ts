import { describe, it, expect, beforeEach } from "vitest";
import { IHttpClient } from "../github/githubAppClient";
import { RawDispatchService } from "./rawDispatchService";

class FakeHttpClient implements IHttpClient {
  public requests: { url: string; options: RequestInit }[] = [];
  public status = 200;
  public body: string | null = null;

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    this.requests.push({ url, options: options ?? {} });
    return new Response(this.body, { status: this.status });
  }
}

describe("RawDispatchService", () => {
  let http: FakeHttpClient;
  let service: RawDispatchService;

  beforeEach(() => {
    http = new FakeHttpClient();
    service = new RawDispatchService(http);
  });

  it("should POST buildId and environment to the endpoint", async () => {
    // When: I dispatch a raw deploy
    await service.dispatch({
      endpointUrl: "https://deploy.acme.com/hook",
      buildId: "sha-123",
      environment: "staging",
    });

    // Then: a JSON POST hits the endpoint with the fixed body shape
    expect(http.requests).toHaveLength(1);
    const req = http.requests[0];
    expect(req.url).toBe("https://deploy.acme.com/hook");
    expect(req.options.method).toBe("POST");
    expect(JSON.parse(req.options.body as string)).toEqual({
      buildId: "sha-123",
      environment: "staging",
    });
  });

  it("should throw when the endpoint responds with an error", async () => {
    // Given: the endpoint rejects
    http.status = 500;

    // When/Then: dispatch surfaces the failure
    await expect(
      service.dispatch({
        endpointUrl: "https://deploy.acme.com/hook",
        buildId: "sha-123",
        environment: "staging",
      }),
    ).rejects.toThrow(/Failed to dispatch raw deploy/);
  });

  it("should keep the endpoint's response body out of the error message", async () => {
    // Given an endpoint that answers with sensitive content. The endpoint URL
    // is chosen by the customer, so it can be pointed at anything GitLaunch's
    // network can reach — its response must never be echoed back to them.
    http.status = 403;
    http.body = '{"Token":"internal-credential"}';

    // When the dispatch fails
    const error: Error = await service
      .dispatch({
        endpointUrl: "http://169.254.169.254/latest/meta-data/",
        buildId: "sha-123",
        environment: "staging",
      })
      .then(() => {
        throw new Error("expected dispatch to reject");
      })
      .catch((e: Error) => e);

    // Then the message carries the status but not the body
    expect(error.message).toContain("403");
    expect(error.message).not.toContain("internal-credential");

    // And the body is still available for server-side logging
    expect((error as { responseBody?: string }).responseBody).toContain(
      "internal-credential",
    );
  });
});
