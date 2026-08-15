import { describe, it, expect } from "vitest";
import { loadConfig, summarizeConfig } from "./loadConfig";
import { BuildIdentity } from "./distribution";

const saasBuild: BuildIdentity = { distribution: "saas", issuerPublicKey: "" };
const selfHostedBuild: BuildIdentity = {
  distribution: "self-hosted",
  issuerPublicKey: "-----BEGIN PUBLIC KEY-----",
};

// A minimum viable environment: everything the server needs regardless of
// distribution or optional feature. Tests start from this and vary one thing.
const baseEnv = {
  PUBLIC_URL: "https://gitlaunch.example.com",
  MONGODB_URI: "mongodb://localhost:27017",
  COOKIE_SECRET_SIGNATURE: "a-signing-secret",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  USE_FAKE_GITHUB: "true",
} as NodeJS.ProcessEnv;

const env = (overrides: Record<string, string | undefined>) =>
  ({ ...baseEnv, ...overrides }) as NodeJS.ProcessEnv;

// A valid self-hosted environment. The self-hosted build refuses fake GitHub
// services, so it always carries real GitHub App credentials.
const selfHostedEnv = {
  ...baseEnv,
  USE_FAKE_GITHUB: "false",
  GH_APP_ID: "12345",
  GH_APP_CLIENT_ID: "Iv1.abc",
  GH_APP_CLIENT_SECRET: "shhh",
  GH_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
} as NodeJS.ProcessEnv;

const shEnv = (overrides: Record<string, string | undefined>) =>
  ({ ...selfHostedEnv, ...overrides }) as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  describe("core requirements", () => {
    it("should return a usable config when the minimum environment is present", () => {
      const config = loadConfig(baseEnv, saasBuild);

      expect(config.publicUrl).toBe("https://gitlaunch.example.com");
      expect(config.mongoUri).toBe("mongodb://localhost:27017");
      expect(config.port).toBe(3050);
    });

    it("should report every missing required setting at once, not just the first", () => {
      // An operator installing on-prem should learn everything that is wrong
      // in one boot, instead of fixing one variable per restart.
      let message = "";
      try {
        loadConfig({} as NodeJS.ProcessEnv, saasBuild);
      } catch (e) {
        message = (e as Error).message;
      }

      expect(message).toContain("PUBLIC_URL");
      expect(message).toContain("MONGODB_URI");
      expect(message).toContain("COOKIE_SECRET_SIGNATURE");
      expect(message).toContain("ENCRYPTION_KEY");
    });

    it("should reject a PUBLIC_URL that is not a valid absolute URL", () => {
      expect(() =>
        loadConfig(env({ PUBLIC_URL: "not-a-url" }), saasBuild),
      ).toThrow(/PUBLIC_URL/);
    });

    it("should reject a PORT that is not a number", () => {
      expect(() => loadConfig(env({ PORT: "http" }), saasBuild)).toThrow(
        /PORT/,
      );
    });

    it("should reject an ENCRYPTION_KEY that is not 32 bytes", () => {
      expect(() =>
        loadConfig(
          env({ ENCRYPTION_KEY: Buffer.alloc(8).toString("base64") }),
          saasBuild,
        ),
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
        saasBuild,
      );

      expect(config.distribution).toBe("saas");
    });
  });

  describe("distribution", () => {
    it("should take the distribution from the build", () => {
      expect(loadConfig(baseEnv, saasBuild).distribution).toBe("saas");
      expect(loadConfig(selfHostedEnv, selfHostedBuild).distribution).toBe(
        "self-hosted",
      );
    });

    it("should ignore any attempt to name the distribution in the environment", () => {
      // Entitlement hangs off the distribution, and a customer controls their
      // own environment. Only the build may decide this — see distribution.ts.
      const config = loadConfig(
        shEnv({
          GITLAUNCH_DISTRIBUTION: "saas",
          GITLAUNCH_EDITION: "saas",
        }),
        selfHostedBuild,
      );

      expect(config.distribution).toBe("self-hosted");
    });
  });

  describe("billing", () => {
    it("should enable billing on the saas build when a Stripe key is present", () => {
      const config = loadConfig(
        env({ STRIPE_SECRET_KEY: "sk_test_123" }),
        saasBuild,
      );
      expect(config.features.billing.enabled).toBe(true);
    });

    it("should disable billing on the saas build when no Stripe key is present", () => {
      // Preserves today's local-dev ergonomics: no Stripe, no billing routes.
      expect(loadConfig(baseEnv, saasBuild).features.billing.enabled).toBe(
        false,
      );
    });

    it("should disable billing on a self-hosted build even when a Stripe key is present", () => {
      // Self-hosted is licensed, not per-seat billed. A stray key from a copied
      // env file must not silently expose billing routes to a customer.
      const config = loadConfig(
        shEnv({ STRIPE_SECRET_KEY: "sk_test_123" }),
        selfHostedBuild,
      );
      expect(config.features.billing.enabled).toBe(false);
    });

    it("should fail when billing is explicitly enabled without a Stripe key", () => {
      expect(() =>
        loadConfig(env({ BILLING_ENABLED: "true" }), saasBuild),
      ).toThrow(/STRIPE_SECRET_KEY/);
    });
  });

  describe("github", () => {
    it("should not require credentials when using fakes", () => {
      expect(loadConfig(baseEnv, saasBuild).github.useFakes).toBe(true);
    });

    it("should run without GitHub integration when nothing is configured", () => {
      // A Jenkins-only install is a supported shape; requiring a GitHub App
      // would block it.
      const config = loadConfig(env({ USE_FAKE_GITHUB: "false" }), saasBuild);

      expect(config.github.enabled).toBe(false);
    });

    it("should name the missing credentials when the GitHub App is half configured", () => {
      // Partial credentials look configured and then fail on first use, which
      // is worse than not being configured at all.
      let message = "";
      try {
        loadConfig(
          env({ USE_FAKE_GITHUB: "false", GH_APP_ID: "12345" }),
          saasBuild,
        );
      } catch (e) {
        message = (e as Error).message;
      }

      expect(message).toContain("GH_APP_CLIENT_ID");
      expect(message).toContain("GH_APP_CLIENT_SECRET");
      expect(message).toContain("GH_APP_PRIVATE_KEY");
    });

    it("should accept a full GitHub App configuration", () => {
      const config = loadConfig(selfHostedEnv, selfHostedBuild);

      expect(config.github.useFakes).toBe(false);
      expect(config.github.appId).toBe("12345");
    });

    it("should refuse fake GitHub services on a self-hosted build", () => {
      // Fakes are a dev affordance. Shipping them to a customer would mean a
      // product that silently does nothing.
      expect(() =>
        loadConfig(env({ USE_FAKE_GITHUB: "true" }), selfHostedBuild),
      ).toThrow(/USE_FAKE_GITHUB/);
    });
  });

  describe("google sign-in", () => {
    it("should stay off when no client id is configured", () => {
      // Self-hosted installs generally use GitHub only; the button must not
      // appear when it would lead nowhere.
      expect(loadConfig(baseEnv, saasBuild).features.googleAuth.enabled).toBe(
        false,
      );
    });

    it("should turn on when a client id and secret are configured", () => {
      const config = loadConfig(
        env({
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
        }),
        saasBuild,
      );
      expect(config.features.googleAuth.enabled).toBe(true);
    });

    it("should fail when a client id is given without a secret", () => {
      expect(() =>
        loadConfig(env({ GOOGLE_CLIENT_ID: "google-client-id" }), saasBuild),
      ).toThrow(/GOOGLE_CLIENT_SECRET/);
    });

    it("should refuse fake google sign-in on a self-hosted build", () => {
      expect(() =>
        loadConfig(shEnv({ USE_FAKE_GOOGLE: "true" }), selfHostedBuild),
      ).toThrow(/USE_FAKE_GOOGLE/);
    });
  });

  describe("optional infrastructure", () => {
    it("should use an in-memory flag cache when no Redis URL is given", () => {
      expect(
        loadConfig(baseEnv, saasBuild).features.flagCache.redisUrl,
      ).toBeUndefined();
    });

    it("should use Redis for the flag cache when a URL is given", () => {
      const config = loadConfig(
        env({ REDIS_URL: "redis://redis:6379" }),
        saasBuild,
      );
      expect(config.features.flagCache.redisUrl).toBe("redis://redis:6379");
    });

    it("should keep the analytics warehouse off by default", () => {
      expect(loadConfig(baseEnv, saasBuild).features.analytics.enabled).toBe(
        false,
      );
    });

    it("should enable the analytics warehouse when requested", () => {
      const config = loadConfig(
        env({ ANALYTICS_WAREHOUSE: "true" }),
        saasBuild,
      );
      expect(config.features.analytics.enabled).toBe(true);
    });

    it("should reject a non-positive analytics retention window", () => {
      expect(() =>
        loadConfig(
          env({ ANALYTICS_WAREHOUSE: "true", ANALYTICS_RETENTION_DAYS: "0" }),
          saasBuild,
        ),
      ).toThrow(/ANALYTICS_RETENTION_DAYS/);
    });

    it("should leave PostHog unconfigured by default", () => {
      expect(loadConfig(baseEnv, saasBuild).features.analytics.posthog).toBe(
        undefined,
      );
    });

    it("should configure PostHog when a project token is set", () => {
      const config = loadConfig(
        env({
          POSTHOG_PROJECT_TOKEN: "phc_abc",
          POSTHOG_HOST: "https://eu.i.posthog.com",
        }),
        saasBuild,
      );
      expect(config.features.analytics.posthog).toEqual({
        projectToken: "phc_abc",
        host: "https://eu.i.posthog.com",
      });
    });

    it("should default to PostHog US cloud when only a token is set", () => {
      const config = loadConfig(
        env({ POSTHOG_PROJECT_TOKEN: "phc_abc" }),
        saasBuild,
      );
      expect(config.features.analytics.posthog?.host).toBe(
        "https://us.i.posthog.com",
      );
    });

    it("should never send a self-hosted install's analytics to our PostHog", () => {
      // A customer's own install must not phone home. Their usage is theirs.
      const config = loadConfig(
        shEnv({ POSTHOG_PROJECT_TOKEN: "phc_abc" }),
        selfHostedBuild,
      );
      expect(config.features.analytics.posthog).toBe(undefined);
    });

    it("should fall back to the console email sender when no API key is set", () => {
      expect(loadConfig(baseEnv, saasBuild).features.email.enabled).toBe(false);
    });

    it("should require a from address once a Resend key is configured", () => {
      expect(() =>
        loadConfig(env({ RESEND_API_KEY: "re_123" }), saasBuild),
      ).toThrow(/EMAIL_FROM/);
    });
  });

  describe("self-hosted flag dogfooding", () => {
    it("should read GitLaunch's own flags on the saas build when a service id is set", () => {
      const config = loadConfig(
        env({ GITLAUNCH_SERVICE_ID: "svc_123" }),
        saasBuild,
      );
      expect(config.features.selfFlags.enabled).toBe(true);
    });

    it("should never read GitLaunch's own flags on a self-hosted build", () => {
      // A customer's install must never phone home to our flag service.
      const config = loadConfig(
        shEnv({ GITLAUNCH_SERVICE_ID: "svc_123" }),
        selfHostedBuild,
      );
      expect(config.features.selfFlags.enabled).toBe(false);
    });
  });

  describe("build simulation", () => {
    it("should refuse build simulation on a self-hosted build", () => {
      expect(() =>
        loadConfig(shEnv({ ENABLE_BUILD_SIMULATION: "true" }), selfHostedBuild),
      ).toThrow(/ENABLE_BUILD_SIMULATION/);
    });
  });

  describe("cookie security", () => {
    // Secure cookies are decided by how the install is actually reached, not by
    // NODE_ENV. A customer serving GitLaunch over plain http with
    // NODE_ENV=production would otherwise set Secure cookies the browser
    // refuses to send back, and sign-in would fail with nothing in the logs.
    it("should mark cookies secure when the install is reached over https", () => {
      const config = loadConfig(
        env({ PUBLIC_URL: "https://gitlaunch.example.com" }),
        saasBuild,
      );

      expect(config.cookies.secure).toBe(true);
    });

    it("should not mark cookies secure when the install is reached over http", () => {
      const config = loadConfig(
        env({ PUBLIC_URL: "http://localhost:3050" }),
        saasBuild,
      );

      expect(config.cookies.secure).toBe(false);
    });

    it("should ignore NODE_ENV when deciding cookie security", () => {
      const overHttp = loadConfig(
        env({ PUBLIC_URL: "http://internal.acme.lan", NODE_ENV: "production" }),
        saasBuild,
      );

      expect(overHttp.cookies.secure).toBe(false);
    });
  });

  describe("development affordances", () => {
    it("should treat an unset NODE_ENV as development", () => {
      expect(
        loadConfig(env({ NODE_ENV: undefined }), saasBuild).isProduction,
      ).toBe(false);
    });

    it("should treat NODE_ENV=production as production", () => {
      expect(
        loadConfig(env({ NODE_ENV: "production" }), saasBuild).isProduction,
      ).toBe(true);
    });
  });
});

describe("summarizeConfig", () => {
  it("should report which optional features resolved on or off", () => {
    const summary = summarizeConfig(
      loadConfig(env({ STRIPE_SECRET_KEY: "sk_test_123" }), saasBuild),
    );

    expect(summary).toContain("distribution=saas");
    expect(summary).toMatch(/billing\s*=\s*on/);
    expect(summary).toMatch(/analytics\s*=\s*off/);
  });

  it("should never reveal secret values", () => {
    const summary = summarizeConfig(
      loadConfig(
        env({
          STRIPE_SECRET_KEY: "sk_test_SUPERSECRET",
          COOKIE_SECRET_SIGNATURE: "cookie-SUPERSECRET",
          MONGODB_URI: "mongodb://user:SUPERSECRET@mongo:27017/gitlaunch",
        }),
        saasBuild,
      ),
    );

    expect(summary).not.toContain("SUPERSECRET");
  });
});
