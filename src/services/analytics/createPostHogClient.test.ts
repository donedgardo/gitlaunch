import { describe, it, expect } from "vitest";
import { createPostHogClient } from "./createPostHogClient";

// Stands in for the posthog-node module: records how it was constructed.
function fakeSdk() {
  const constructed: Array<{ token: string; options: any }> = [];
  const loader = () => ({
    PostHog: class {
      constructor(token: string, options: any) {
        constructed.push({ token, options });
      }
      capture() {}
      identify() {}
      async flush() {}
      async shutdown() {}
    },
  });
  return { loader, constructed };
}

describe("createPostHogClient", () => {
  it("should return no client when PostHog is not configured", () => {
    // Given no PostHog settings
    const { loader, constructed } = fakeSdk();

    // When a client is requested
    const client = createPostHogClient(undefined, loader);

    // Then nothing is built, and analytics simply has one destination fewer
    expect(client).toBe(undefined);
    expect(constructed).toHaveLength(0);
  });

  it("should build a client from the configured project and host", () => {
    // Given PostHog settings
    const { loader, constructed } = fakeSdk();

    // When a client is requested
    const client = createPostHogClient(
      { projectToken: "phc_abc", host: "https://eu.i.posthog.com" },
      loader,
    );

    // Then it points at that project
    expect(client).toBeDefined();
    expect(constructed[0].token).toBe("phc_abc");
    expect(constructed[0].options.host).toBe("https://eu.i.posthog.com");
  });

  it("should degrade to no client when the SDK is not installed", () => {
    // Given an install without posthog-node
    const loader = () => {
      throw new Error("Cannot find module 'posthog-node'");
    };

    // When a client is requested
    // Then boot continues without analytics rather than crashing
    expect(() =>
      createPostHogClient({ projectToken: "phc_abc", host: "h" }, loader),
    ).not.toThrow();
    expect(
      createPostHogClient({ projectToken: "phc_abc", host: "h" }, loader),
    ).toBe(undefined);
  });
});
