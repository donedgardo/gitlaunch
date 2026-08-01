import { describe, it, expect } from "vitest";
import { loadConfig, summarizeConfig } from "./loadConfig";

// A minimum viable environment: everything the server needs regardless of
// edition or optional feature. Tests start from this and vary one thing.
const baseEnv = {
  PUBLIC_URL: "https://gitlaunch.example.com",
  MONGODB_URI: "mongodb://localhost:27017",
  COOKIE_SECRET_SIGNATURE: "a-signing-secret",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  USE_FAKE_GITHUB: "true",
} as NodeJS.ProcessEnv;

const env = (overrides: Record<string, string | undefined>) =>
  ({ ...baseEnv, ...overrides }) as NodeJS.ProcessEnv;

// A valid enterprise environment. Enterprise refuses fake GitHub services, so
// it always carries real GitHub App credentials.
const enterpriseEnv = {
  ...baseEnv,
  GITLAUNCH_EDITION: "enterprise",
  USE_FAKE_GITHUB: "false",
  GH_APP_ID: "12345",
  GH_APP_CLIENT_ID: "Iv1.abc",
  GH_APP_CLIENT_SECRET: "shhh",
  GH_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
} as NodeJS.ProcessEnv;

const entEnv = (overrides: Record<string, string | undefined>) =>
  ({ ...enterpriseEnv, ...overrides }) as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  describe("core requirements", () => {
    it("should return a usable config when the minimum environment is present", () => {
      const config = loadConfig(baseEnv);

      expect(config.publicUrl).toBe("https://gitlaunch.example.com");
      expect(config.mongoUri).toBe("mongodb://localhost:27017");
      expect(config.port).toBe(3050);
    });

    it("should report every missing required setting at once, not just the first", () => {
      // An operator installing on-prem should learn everything that is wrong
      // in one boot, instead of fixing one variable per restart.
      let message = "";
      try {
        loadConfig({} as NodeJS.ProcessEnv);
      } catch (e) {
        message = (e as Error).message;
      }

      expect(message).toContain("PUBLIC_URL");
      expect(message).toContain("MONGODB_URI");
      expect(message).toContain("COOKIE_SECRET_SIGNATURE");
      expect(message).toContain("ENCRYPTION_KEY");
    });

    it("should reject a PUBLIC_URL that is not a valid absolute URL", () => {
      expect(() => loadConfig(env({ PUBLIC_URL: "not-a-url" }))).toThrow(
        /PUBLIC_URL/,
      );
    });

    it("should reject a PORT that is not a number", () => {
      expect(() => loadConfig(env({ PORT: "http" }))).toThrow(/PORT/);
    });

    it("should reject an ENCRYPTION_KEY that is not 32 bytes", () => {
      expect(() =>
        loadConfig(env({ ENCRYPTION_KEY: Buffer.alloc(8).toString("base64") })),
      ).toThrow(/ENCRYPTION_KEY/);
    });

    it("should accept an encryption keyring instead of a single key", () => {
      const key = Buffer.alloc(32, 2).toString("base64");
      const config = loadConfig(
        env({
          ENCRYPTION_KEY: undefined,
          ENCRYPTION_KEYS: `2026a:${key}`,
          ENCRYPTION_PRIMARY_KEY_ID: "2026a",
        }),
      );

      expect(config.edition).toBe("saas");
    });
  });

  describe("edition", () => {
    it("should default to the saas edition when unset", () => {
      expect(loadConfig(baseEnv).edition).toBe("saas");
    });

    it("should use the enterprise edition when requested", () => {
      expect(loadConfig(enterpriseEnv).edition).toBe("enterprise");
    });

    it("should reject an unknown edition", () => {
      expect(() => loadConfig(env({ GITLAUNCH_EDITION: "onprem" }))).toThrow(
        /GITLAUNCH_EDITION/,
      );
    });
  });

  describe("billing", () => {
    it("should enable billing in saas when a Stripe key is present", () => {
      const config = loadConfig(env({ STRIPE_SECRET_KEY: "sk_test_123" }));
      expect(config.features.billing.enabled).toBe(true);
    });

    it("should disable billing in saas when no Stripe key is present", () => {
      // Preserves today's local-dev ergonomics: no Stripe, no billing routes.
      expect(loadConfig(baseEnv).features.billing.enabled).toBe(false);
    });

    it("should disable billing in enterprise even when a Stripe key is present", () => {
      // Enterprise is licensed, not per-seat billed. A stray key from a copied
      // env file must not silently expose billing routes on-prem.
      const config = loadConfig(entEnv({ STRIPE_SECRET_KEY: "sk_test_123" }));
      expect(config.features.billing.enabled).toBe(false);
    });

    it("should fail when billing is explicitly enabled without a Stripe key", () => {
      expect(() => loadConfig(env({ BILLING_ENABLED: "true" }))).toThrow(
        /STRIPE_SECRET_KEY/,
      );
    });

    it("should allow enterprise to opt into billing explicitly", () => {
      const config = loadConfig(
        entEnv({ BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_123" }),
      );
      expect(config.features.billing.enabled).toBe(true);
    });
  });

  describe("github", () => {
    it("should not require credentials when using fakes", () => {
      expect(loadConfig(baseEnv).github.useFakes).toBe(true);
    });

    it("should name every missing GitHub App credential when fakes are off", () => {
      let message = "";
      try {
        loadConfig(env({ USE_FAKE_GITHUB: "false" }));
      } catch (e) {
        message = (e as Error).message;
      }

      expect(message).toContain("GH_APP_ID");
      expect(message).toContain("GH_APP_CLIENT_ID");
      expect(message).toContain("GH_APP_CLIENT_SECRET");
      expect(message).toContain("GH_APP_PRIVATE_KEY");
    });

    it("should accept a full GitHub App configuration", () => {
      const config = loadConfig(
        env({
          USE_FAKE_GITHUB: "false",
          GH_APP_ID: "12345",
          GH_APP_CLIENT_ID: "Iv1.abc",
          GH_APP_CLIENT_SECRET: "shhh",
          GH_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
          GH_APP_NAME: "gitlaunch-onprem",
        }),
      );

      expect(config.github.useFakes).toBe(false);
      expect(config.github.appId).toBe("12345");
    });

    it("should refuse fake GitHub services in the enterprise edition", () => {
      // Fakes are a dev affordance. Shipping them to a customer would mean a
      // product that silently does nothing.
      expect(() =>
        loadConfig(env({ GITLAUNCH_EDITION: "enterprise" })),
      ).toThrow(/USE_FAKE_GITHUB/);
    });
  });

  describe("optional infrastructure", () => {
    it("should use an in-memory flag cache when no Redis URL is given", () => {
      expect(loadConfig(baseEnv).features.flagCache.redisUrl).toBeUndefined();
    });

    it("should use Redis for the flag cache when a URL is given", () => {
      const config = loadConfig(env({ REDIS_URL: "redis://redis:6379" }));
      expect(config.features.flagCache.redisUrl).toBe("redis://redis:6379");
    });

    it("should keep the analytics warehouse off by default", () => {
      expect(loadConfig(baseEnv).features.analytics.enabled).toBe(false);
    });

    it("should enable the analytics warehouse when requested", () => {
      const config = loadConfig(env({ ANALYTICS_WAREHOUSE: "true" }));
      expect(config.features.analytics.enabled).toBe(true);
    });

    it("should reject a non-positive analytics retention window", () => {
      expect(() =>
        loadConfig(
          env({ ANALYTICS_WAREHOUSE: "true", ANALYTICS_RETENTION_DAYS: "0" }),
        ),
      ).toThrow(/ANALYTICS_RETENTION_DAYS/);
    });
  });

  describe("self-hosted flag dogfooding", () => {
    it("should read GitLaunch's own flags in saas when a service id is set", () => {
      const config = loadConfig(env({ GITLAUNCH_SERVICE_ID: "svc_123" }));
      expect(config.features.selfFlags.enabled).toBe(true);
    });

    it("should disable GitLaunch's own flag reads in enterprise", () => {
      // A customer's install must never phone home to our flag service.
      const config = loadConfig(entEnv({ GITLAUNCH_SERVICE_ID: "svc_123" }));
      expect(config.features.selfFlags.enabled).toBe(false);
    });
  });

  describe("build simulation", () => {
    it("should refuse build simulation in the enterprise edition", () => {
      expect(() =>
        loadConfig(entEnv({ ENABLE_BUILD_SIMULATION: "true" })),
      ).toThrow(/ENABLE_BUILD_SIMULATION/);
    });
  });
});

describe("summarizeConfig", () => {
  it("should report which optional features resolved on or off", () => {
    const summary = summarizeConfig(
      loadConfig(env({ STRIPE_SECRET_KEY: "sk_test_123" })),
    );

    expect(summary).toContain("edition=saas");
    expect(summary).toMatch(/billing\s*=\s*on/);
    expect(summary).toMatch(/analytics\s*=\s*off/);
  });

  it("should never reveal secret values", () => {
    const summary = summarizeConfig(
      loadConfig(
        env({
          STRIPE_SECRET_KEY: "sk_test_SUPERSECRET",
          COOKIE_SECRET_SIGNATURE: "cookie-SUPERSECRET",
        }),
      ),
    );

    expect(summary).not.toContain("SUPERSECRET");
  });
});
