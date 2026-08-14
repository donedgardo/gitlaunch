import { describe, it, expect, beforeEach } from "vitest";
import { IHttpClient } from "../github/githubAppClient";
import {
  JenkinsDispatchService,
  JenkinsDispatchInput,
} from "./jenkinsDispatchService";

// Fake HTTP client: records requests and answers the crumb GET and the
// buildWithParameters POST independently by URL.
class FakeHttpClient implements IHttpClient {
  public requests: { url: string; options: RequestInit }[] = [];
  public crumbStatus = 200;
  public crumbBody: unknown = {
    crumbRequestField: "Jenkins-Crumb",
    crumb: "crumb-abc",
  };
  public buildStatus = 201;
  public buildBody: string | null = null;

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    this.requests.push({ url, options: options ?? {} });
    if (url.includes("/crumbIssuer/")) {
      return new Response(
        this.crumbStatus === 200 ? JSON.stringify(this.crumbBody) : null,
        { status: this.crumbStatus },
      );
    }
    return new Response(this.buildBody, { status: this.buildStatus });
  }

  post() {
    return this.requests.find((r) => r.url.includes("/buildWithParameters"));
  }
  crumb() {
    return this.requests.find((r) => r.url.includes("/crumbIssuer/"));
  }
}

const validInput: JenkinsDispatchInput = {
  baseUrl: "https://ci.acme.com",
  username: "deploy-bot",
  apiToken: "secret-token",
  jobName: "deploy-backend",
  buildId: "build-123",
  environment: "staging",
  serviceId: "svc-abc",
};

const EXPECTED_AUTH =
  "Basic " + Buffer.from("deploy-bot:secret-token").toString("base64");

describe("JenkinsDispatchService", () => {
  let http: FakeHttpClient;
  let service: JenkinsDispatchService;

  beforeEach(() => {
    http = new FakeHttpClient();
    service = new JenkinsDispatchService(http);
  });

  it("should POST buildWithParameters with buildId, environment and serviceId", async () => {
    await service.dispatch(validInput);

    const post = http.post();
    expect(post?.url).toBe(
      "https://ci.acme.com/job/deploy-backend/buildWithParameters",
    );
    expect(post?.options.method).toBe("POST");
    const body = String(post?.options.body);
    expect(body).toContain("buildId=build-123");
    expect(body).toContain("environment=staging");
    expect(body).toContain("serviceId=svc-abc");
  });

  it("should authenticate both requests with basic auth", async () => {
    await service.dispatch(validInput);

    const headersOf = (o?: RequestInit) =>
      (o?.headers ?? {}) as Record<string, string>;
    expect(headersOf(http.crumb()?.options).Authorization).toBe(EXPECTED_AUTH);
    expect(headersOf(http.post()?.options).Authorization).toBe(EXPECTED_AUTH);
  });

  it("should include the CSRF crumb header on the build request", async () => {
    await service.dispatch(validInput);

    const headers = (http.post()?.options.headers ?? {}) as Record<
      string,
      string
    >;
    expect(headers["Jenkins-Crumb"]).toBe("crumb-abc");
  });

  it("should proceed without a crumb when the crumb issuer is disabled", async () => {
    http.crumbStatus = 404;

    await service.dispatch(validInput);

    // The build was still dispatched...
    expect(http.post()).toBeDefined();
    // ...with no crumb header
    const headers = (http.post()?.options.headers ?? {}) as Record<
      string,
      string
    >;
    expect(headers["Jenkins-Crumb"]).toBeUndefined();
  });

  it("should normalize a trailing slash in the base URL", async () => {
    await service.dispatch({ ...validInput, baseUrl: "https://ci.acme.com/" });

    expect(http.crumb()?.url).toBe("https://ci.acme.com/crumbIssuer/api/json");
    expect(http.post()?.url).toBe(
      "https://ci.acme.com/job/deploy-backend/buildWithParameters",
    );
  });

  it("should throw when the build request fails", async () => {
    http.buildStatus = 500;

    await expect(service.dispatch(validInput)).rejects.toThrow(
      /Failed to dispatch Jenkins build.*500/,
    );
  });

  it("should keep the Jenkins response body out of the error message", async () => {
    // Given a Jenkins server that answers with page content. The base URL is
    // supplied by the customer, so its response must not be echoed back.
    http.buildStatus = 500;
    http.buildBody = "<html>internal-stack-trace</html>";

    // When the dispatch fails
    const error: Error = await service
      .dispatch(validInput)
      .then(() => {
        throw new Error("expected dispatch to reject");
      })
      .catch((e: Error) => e);

    // Then the status is reported but the body is not
    expect(error.message).toContain("500");
    expect(error.message).not.toContain("internal-stack-trace");
    expect((error as { responseBody?: string }).responseBody).toContain(
      "internal-stack-trace",
    );
  });
});
