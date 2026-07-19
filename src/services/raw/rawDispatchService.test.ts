import { describe, it, expect, beforeEach } from "vitest";
import { IHttpClient } from "../github/githubAppClient";
import { RawDispatchService } from "./rawDispatchService";

class FakeHttpClient implements IHttpClient {
  public requests: { url: string; options: RequestInit }[] = [];
  public status = 200;

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    this.requests.push({ url, options: options ?? {} });
    return new Response(null, { status: this.status });
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
});
