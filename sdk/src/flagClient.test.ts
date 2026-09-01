import { describe, it, expect, vi, afterEach } from "vitest";
import { createFlagClient, FlagDecision } from "./flagClient";

// A contract-shaped fake of the GitLaunch flags API. It answers the two runtime
// endpoints an app talks to and records what it was asked, so tests can assert
// on the wire contract without a server.
type FakeServerOptions = {
  decisions?: Record<string, FlagDecision>;
  perEntity?: Record<string, Record<string, FlagDecision>>;
  bundleUrl?: string;
  bundleBody?: unknown;
};

function fakeFlagsApi(options: FakeServerOptions = {}) {
  const requests: { url: string; method: string; body?: any; headers: any }[] =
    [];
  let failWith: string | null = null;
  let hang = false;
  let bundleFailWith: string | null = null;

  const fetchImpl = async (url: string, init: any = {}) => {
    if (options.bundleUrl && url === options.bundleUrl) {
      requests.push({ url, method: "GET", headers: init.headers ?? {} });
      if (bundleFailWith) throw new Error(bundleFailWith);
      return jsonResponse(
        options.bundleBody ?? { environment: "prod", flags: [] },
      );
    }

    if (hang) {
      // Resolve only if the caller gives up first — that is what a slow API
      // looks like from inside the client.
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }) as Promise<any>;
    }
    if (failWith) throw new Error(failWith);

    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body, headers: init.headers ?? {} });

    if (parsed.pathname.endsWith("/flags/evaluate")) {
      const entity = parsed.searchParams.get("entity") ?? "";
      const flags = options.perEntity?.[entity] ?? options.decisions ?? {};
      return jsonResponse({ environment: "prod", entity, flags });
    }
    if (parsed.pathname.endsWith("/conversions")) {
      return jsonResponse({ recorded: true, variant: "control" }, 201);
    }
    return jsonResponse({ error: "not found" }, 404);
  };

  return {
    fetch: fetchImpl as unknown as typeof fetch,
    requests,
    get calls() {
      return requests.length;
    },
    evaluateCalls() {
      return requests.filter((r) => r.url.includes("/flags/evaluate")).length;
    },
    bundleCalls() {
      return requests.filter((r) => r.url === options.bundleUrl).length;
    },
    goDown(message = "network unreachable") {
      failWith = message;
    },
    bundleGoDown(message = "bundle unreachable") {
      bundleFailWith = message;
    },
    comeBack() {
      failWith = null;
      hang = false;
    },
    goSlow() {
      hang = true;
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function on(variant: string | null = null, reason = "rollout"): FlagDecision {
  return { enabled: true, variant, reason };
}

function client(server: ReturnType<typeof fakeFlagsApi>, overrides: any = {}) {
  return createFlagClient({
    apiUrl: "https://gitlaunch.dev",
    serviceId: "svc123",
    environment: "prod",
    apiKey: "pk_test",
    fetch: server.fetch,
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("FlagClient", () => {
  describe("isEnabled", () => {
    it("should return the server's decision when the flag is live", async () => {
      const server = fakeFlagsApi({ decisions: { checkout: on() } });

      const enabled = await client(server).isEnabled("checkout", {
        entity: "user-1",
      });

      expect(enabled).toBe(true);
    });

    it("should return the fallback when the server has no such flag", async () => {
      const server = fakeFlagsApi({ decisions: {} });
      const flags = client(server);

      expect(await flags.isEnabled("unknown", { entity: "user-1" })).toBe(
        false,
      );
      expect(await flags.isEnabled("unknown", { entity: "user-1" }, true)).toBe(
        true,
      );
    });
  });

  describe("variant", () => {
    it("should return the variant the entity was assigned", async () => {
      const server = fakeFlagsApi({
        decisions: { hero: on("benefit-led") },
      });

      const variant = await client(server).variant("hero", {
        entity: "user-1",
      });

      expect(variant).toBe("benefit-led");
    });

    it("should return the fallback when the flag is unknown", async () => {
      const server = fakeFlagsApi({ decisions: {} });

      const variant = await client(server).variant(
        "hero",
        { entity: "user-1" },
        "control",
      );

      expect(variant).toBe("control");
    });
  });

  describe("evaluating", () => {
    it("should identify the entity and its attributes to the API", async () => {
      const server = fakeFlagsApi({ decisions: { checkout: on() } });

      await client(server).isEnabled("checkout", {
        entity: "user-1",
        attributes: { plan: "pro", seats: 12 },
      });

      const url = new URL(server.requests[0].url);
      expect(url.pathname).toBe(
        "/api/v1/services/svc123/environments/prod/flags/evaluate",
      );
      expect(url.searchParams.get("entity")).toBe("user-1");
      expect(url.searchParams.get("attr.plan")).toBe("pro");
      expect(url.searchParams.get("attr.seats")).toBe("12");
      expect(server.requests[0].headers.Authorization).toBe("Bearer pk_test");
    });

    it("should answer every flag for an entity from one round trip", async () => {
      const server = fakeFlagsApi({
        decisions: { checkout: on(), hero: on("benefit-led") },
      });
      const flags = client(server);
      const ctx = { entity: "user-1" };

      expect(await flags.isEnabled("checkout", ctx)).toBe(true);
      expect(await flags.variant("hero", ctx)).toBe("benefit-led");
      expect(await flags.isEnabled("checkout", ctx)).toBe(true);

      expect(server.evaluateCalls()).toBe(1);
    });

    it("should share one round trip between checks made at the same time", async () => {
      const server = fakeFlagsApi({ decisions: { checkout: on() } });
      const flags = client(server);
      const ctx = { entity: "user-1" };

      const [a, b] = await Promise.all([
        flags.isEnabled("checkout", ctx),
        flags.isEnabled("checkout", ctx),
      ]);

      expect([a, b]).toEqual([true, true]);
      expect(server.evaluateCalls()).toBe(1);
    });

    it("should decide separately for each entity", async () => {
      const server = fakeFlagsApi({
        perEntity: {
          "user-1": { checkout: on() },
          "user-2": {
            checkout: { enabled: false, variant: null, reason: "rollout" },
          },
        },
      });
      const flags = client(server);

      expect(await flags.isEnabled("checkout", { entity: "user-1" })).toBe(
        true,
      );
      expect(await flags.isEnabled("checkout", { entity: "user-2" })).toBe(
        false,
      );
    });

    it("should re-evaluate when the same entity's attributes change", async () => {
      const server = fakeFlagsApi({ decisions: { checkout: on() } });
      const flags = client(server);

      await flags.isEnabled("checkout", {
        entity: "user-1",
        attributes: { plan: "free" },
      });
      await flags.isEnabled("checkout", {
        entity: "user-1",
        attributes: { plan: "pro" },
      });

      // Attributes drive targeting rules, so a cached free-plan answer must not
      // be served to the same user once they upgrade.
      expect(server.evaluateCalls()).toBe(2);
    });

    it("should pick up config changes once the cached decisions go stale", async () => {
      const server = fakeFlagsApi({ decisions: { checkout: on() } });
      let clock = 0;
      const flags = client(server, { ttlMs: 30_000, now: () => clock });

      await flags.isEnabled("checkout", { entity: "user-1" });
      clock += 29_000;
      await flags.isEnabled("checkout", { entity: "user-1" });
      expect(server.evaluateCalls()).toBe(1);

      clock += 2_000;
      await flags.isEnabled("checkout", { entity: "user-1" });
      expect(server.evaluateCalls()).toBe(2);
    });
  });

  describe("when the flags API is unreachable", () => {
    it("should return the fallback instead of throwing", async () => {
      const server = fakeFlagsApi();
      server.goDown();

      const flags = client(server);

      expect(await flags.isEnabled("checkout", { entity: "user-1" })).toBe(
        false,
      );
      expect(await flags.variant("hero", { entity: "user-1" }, "control")).toBe(
        "control",
      );
    });

    it("should keep serving the last known decisions rather than fall back", async () => {
      const server = fakeFlagsApi({ decisions: { checkout: on() } });
      let clock = 0;
      const flags = client(server, { ttlMs: 1_000, now: () => clock });

      expect(await flags.isEnabled("checkout", { entity: "user-1" })).toBe(
        true,
      );

      clock += 5_000;
      server.goDown();

      // An outage must not silently switch every user back to the fallback —
      // the last good answer is closer to the truth than `false`.
      expect(await flags.isEnabled("checkout", { entity: "user-1" })).toBe(
        true,
      );
    });

    it("should report the failure without breaking the caller", async () => {
      const server = fakeFlagsApi();
      server.goDown("DNS exploded");
      const seen: unknown[] = [];

      const flags = client(server, { onError: (e: unknown) => seen.push(e) });
      await flags.isEnabled("checkout", { entity: "user-1" });

      expect(seen).toHaveLength(1);
      expect((seen[0] as Error).message).toContain("DNS exploded");
    });

    it("should give up on a slow API and use the fallback", async () => {
      vi.useFakeTimers();
      const server = fakeFlagsApi();
      server.goSlow();
      const flags = client(server, { timeoutMs: 500 });

      const pending = flags.isEnabled("checkout", { entity: "user-1" }, true);
      await vi.advanceTimersByTimeAsync(600);

      expect(await pending).toBe(true);
    });
  });

  describe("evaluating from a published bundle", () => {
    const bundleUrl = "https://pub-abc.r2.dev/flags/slug123/prod.json";

    it("should evaluate locally from the bundle instead of calling the HTTP evaluate endpoint", async () => {
      const server = fakeFlagsApi({
        bundleUrl,
        bundleBody: {
          environment: "prod",
          flags: [
            {
              key: "checkout",
              config: { enabled: true, rolloutPercentage: 100, variants: [] },
            },
          ],
        },
      });
      const flags = client(server, { bundleUrl });

      const enabled = await flags.isEnabled("checkout", { entity: "user-1" });

      expect(enabled).toBe(true);
      expect(server.bundleCalls()).toBe(1);
      expect(server.evaluateCalls()).toBe(0);
    });

    it("should respect targeting rules and attributes when evaluating from the bundle", async () => {
      const server = fakeFlagsApi({
        bundleUrl,
        bundleBody: {
          environment: "prod",
          flags: [
            {
              key: "hero",
              config: {
                enabled: true,
                rolloutPercentage: 0,
                variants: [],
                targetingRules: [
                  {
                    conditions: [
                      { attribute: "plan", operator: "eq", values: ["pro"] },
                    ],
                    serve: "benefit-led",
                  },
                ],
              },
            },
          ],
        },
      });
      const flags = client(server, { bundleUrl });

      const variant = await flags.variant("hero", {
        entity: "user-1",
        attributes: { plan: "pro" },
      });

      expect(variant).toBe("benefit-led");
    });

    it("should fall back to the HTTP evaluate endpoint when the bundle fetch fails", async () => {
      const server = fakeFlagsApi({
        bundleUrl,
        decisions: { checkout: on() },
      });
      server.bundleGoDown();
      const flags = client(server, { bundleUrl });

      const enabled = await flags.isEnabled("checkout", { entity: "user-1" });

      expect(enabled).toBe(true);
      expect(server.evaluateCalls()).toBe(1);
    });

    it("should report the bundle failure without breaking the caller", async () => {
      const server = fakeFlagsApi({ bundleUrl, decisions: { checkout: on() } });
      server.bundleGoDown("bundle CDN outage");
      const seen: unknown[] = [];
      const flags = client(server, {
        bundleUrl,
        onError: (e: unknown) => seen.push(e),
      });

      await flags.isEnabled("checkout", { entity: "user-1" });

      expect(seen).toHaveLength(1);
      expect((seen[0] as Error).message).toContain("bundle CDN outage");
    });

    it("should behave exactly as before when no bundleUrl is configured", async () => {
      const server = fakeFlagsApi({ decisions: { checkout: on() } });
      const flags = client(server);

      expect(await flags.isEnabled("checkout", { entity: "user-1" })).toBe(
        true,
      );
      expect(server.evaluateCalls()).toBe(1);
    });
  });

  describe("track", () => {
    it("should record a conversion against the entity", async () => {
      const server = fakeFlagsApi({ decisions: { checkout: on() } });
      const flags = client(server);

      const recorded = await flags.track("checkout", {
        entity: "user-1",
        attributes: { plan: "pro" },
        goal: "purchase",
        value: 49,
      });

      expect(recorded).toBe(true);
      const request = server.requests.find((r) => r.method === "POST")!;
      expect(new URL(request.url).pathname).toBe(
        "/api/v1/services/svc123/environments/prod/flags/checkout/conversions",
      );
      expect(request.body).toEqual({
        entity: "user-1",
        goal: "purchase",
        value: 49,
        attributes: { plan: "pro" },
      });
    });

    it("should not break the caller when the conversion cannot be recorded", async () => {
      const server = fakeFlagsApi();
      server.goDown();
      const flags = client(server);

      await expect(
        flags.track("checkout", { entity: "user-1", goal: "purchase" }),
      ).resolves.toBe(false);
    });
  });
});
