// Single source of truth for GitLaunch's runtime configuration.
//
// Why this exists: GitLaunch ships two ways — as our hosted SaaS and as a
// self-hosted build a customer runs in their own cluster. Those two want
// different things switched on. Reading `process.env` ad hoc at a dozen call
// sites makes that difference invisible and lets a misconfigured on-prem
// install boot "successfully" with features silently missing.
//
// So: every setting is declared here, validated once at boot, and every problem
// is reported together. An operator fixes their values file in one pass instead
// of one restart per missing variable.
//
// Which distribution this is comes from the BUILD, never from the environment
// (see services/licensing/distribution.ts). A customer controls their own
// environment, so anything they can set is something they can set to whatever
// they like — and entitlement hangs off the distribution. This module only
// *reads* that decision to pick sensible defaults for optional features.

import {
  BUILD,
  BuildIdentity,
  Distribution,
} from "../services/licensing/distribution";

export type Config = {
  distribution: Distribution;
  publicUrl: string;
  port: number;
  mongoUri: string;
  cookieSecret: string;
  github: {
    enabled: boolean;
    useFakes: boolean;
    appId?: string;
    appName?: string;
    clientId?: string;
    clientSecret?: string;
    privateKey?: string;
  };
  features: {
    billing: {
      enabled: boolean;
      secretKey?: string;
      webhookSecret?: string;
      proPriceId?: string;
      teamPriceId?: string;
      successUrl: string;
      cancelUrl: string;
    };
    googleAuth: {
      enabled: boolean;
      useFakes: boolean;
      clientId?: string;
      clientSecret?: string;
    };
    email: { enabled: boolean; apiKey?: string; from?: string };
    analytics: { enabled: boolean; retentionDays?: number };
    flagCache: { redisUrl?: string };
    selfFlags: { enabled: boolean; serviceId?: string };
    buildSimulation: { enabled: boolean };
  };
};

/** "true"/"false" -> boolean; anything unset -> undefined (i.e. "no opinion"). */
function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function decodesTo32Bytes(base64: string): boolean {
  try {
    return Buffer.from(base64, "base64").length === 32;
  } catch {
    return false;
  }
}

/** Strip any user:password@ out of a connection string before logging it. */
function redactUri(uri: string): string {
  return uri.replace(/:\/\/[^@/]*@/, "://***:***@");
}

function validateEncryption(env: NodeJS.ProcessEnv, problems: string[]): void {
  const keyring = trimmed(env.ENCRYPTION_KEYS);

  if (keyring) {
    const entries = keyring
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    if (entries.length === 0) {
      problems.push("ENCRYPTION_KEYS is set but empty");
      return;
    }

    const ids: string[] = [];
    for (const entry of entries) {
      const sep = entry.indexOf(":");
      if (sep <= 0) {
        problems.push(
          'ENCRYPTION_KEYS entries must look like "<id>:<base64key>"',
        );
        continue;
      }
      const id = entry.slice(0, sep);
      ids.push(id);
      if (!decodesTo32Bytes(entry.slice(sep + 1))) {
        problems.push(
          `ENCRYPTION_KEYS key "${id}" must decode to exactly 32 bytes`,
        );
      }
    }

    const primary = trimmed(env.ENCRYPTION_PRIMARY_KEY_ID);
    if (!primary) {
      problems.push(
        "ENCRYPTION_PRIMARY_KEY_ID is required when ENCRYPTION_KEYS is set",
      );
    } else if (!ids.includes(primary)) {
      problems.push(
        `ENCRYPTION_PRIMARY_KEY_ID "${primary}" names no key in ENCRYPTION_KEYS`,
      );
    }
    return;
  }

  const single = trimmed(env.ENCRYPTION_KEY);
  if (!single) {
    problems.push(
      "ENCRYPTION_KEY is required (32 random bytes, base64) — " +
        "generate with: openssl rand -base64 32",
    );
    return;
  }
  if (!decodesTo32Bytes(single)) {
    problems.push(
      "ENCRYPTION_KEY must decode to exactly 32 bytes — " +
        "generate with: openssl rand -base64 32",
    );
  }
}

/**
 * Build the validated runtime config from an environment and a build identity.
 *
 * Throws a single Error listing every problem found, so an operator sees the
 * whole picture at once.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  build: BuildIdentity = BUILD,
): Config {
  const problems: string[] = [];
  const distribution = build.distribution;
  const isSelfHosted = distribution === "self-hosted";

  // --- core ----------------------------------------------------------------
  const publicUrl = trimmed(env.PUBLIC_URL);
  if (!publicUrl) {
    problems.push("PUBLIC_URL is required (the externally reachable base URL)");
  } else {
    try {
      const parsed = new URL(publicUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        problems.push("PUBLIC_URL must be an http(s) URL");
      }
    } catch {
      problems.push(`PUBLIC_URL must be an absolute URL (got "${publicUrl}")`);
    }
  }

  const mongoUri = trimmed(env.MONGODB_URI);
  if (!mongoUri) problems.push("MONGODB_URI is required");

  const cookieSecret = trimmed(env.COOKIE_SECRET_SIGNATURE);
  if (!cookieSecret) {
    problems.push("COOKIE_SECRET_SIGNATURE is required (session signing key)");
  }

  let port = 3050;
  const rawPort = trimmed(env.PORT);
  if (rawPort !== undefined) {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      problems.push(
        `PORT must be an integer between 1 and 65535 (got "${rawPort}")`,
      );
    } else {
      port = parsed;
    }
  }

  validateEncryption(env, problems);

  // --- github (optional: a Jenkins-only install needs no GitHub App) --------
  // All four credentials or none. A partial set is always a mistake — it looks
  // configured but fails on first use — so it is worth failing the boot over.
  const useFakes = parseBool(env.USE_FAKE_GITHUB) ?? false;
  if (isSelfHosted && useFakes) {
    problems.push(
      "USE_FAKE_GITHUB must be false on a self-hosted build — " +
        "fakes are a development affordance and would ship a product that does nothing",
    );
  }

  const githubCredentials = {
    GH_APP_ID: trimmed(env.GH_APP_ID),
    GH_APP_CLIENT_ID: trimmed(env.GH_APP_CLIENT_ID),
    GH_APP_CLIENT_SECRET: trimmed(env.GH_APP_CLIENT_SECRET),
    GH_APP_PRIVATE_KEY: trimmed(env.GH_APP_PRIVATE_KEY),
  };
  const suppliedGithub = Object.entries(githubCredentials).filter(
    ([, v]) => v !== undefined,
  );
  const missingGithub = Object.entries(githubCredentials)
    .filter(([, v]) => v === undefined)
    .map(([k]) => k);

  if (!useFakes && suppliedGithub.length > 0 && missingGithub.length > 0) {
    problems.push(
      `GitHub App configuration is incomplete — also set ${missingGithub.join(", ")} ` +
        "(or unset them all to run without GitHub integration)",
    );
  }
  const githubEnabled = useFakes || missingGithub.length === 0;

  // --- google sign-in (optional everywhere) --------------------------------
  // Most self-hosted installs authenticate with GitHub alone. The button only
  // appears when this is actually configured, so it can never lead nowhere.
  const useFakeGoogle = parseBool(env.USE_FAKE_GOOGLE) ?? false;
  const googleClientId = trimmed(env.GOOGLE_CLIENT_ID);
  const googleClientSecret = trimmed(env.GOOGLE_CLIENT_SECRET);
  if (isSelfHosted && useFakeGoogle) {
    problems.push(
      "USE_FAKE_GOOGLE must be false on a self-hosted build — " +
        "it accepts any sign-in without contacting Google",
    );
  }
  if (googleClientId && !googleClientSecret) {
    problems.push(
      "GOOGLE_CLIENT_SECRET is required when GOOGLE_CLIENT_ID is set",
    );
  }
  const googleEnabled =
    (googleClientId !== undefined && googleClientSecret !== undefined) ||
    (useFakeGoogle && !isSelfHosted);

  // --- billing -------------------------------------------------------------
  // Self-hosted is licensed, not per-seat billed. A Stripe key left over in a
  // copied env file must not silently expose billing routes to a customer, so
  // it stays off unless someone opts in on purpose.
  const stripeSecretKey = trimmed(env.STRIPE_SECRET_KEY);
  const billingOverride = parseBool(env.BILLING_ENABLED);
  const billingEnabled =
    billingOverride ?? (!isSelfHosted && stripeSecretKey !== undefined);

  if (billingEnabled && !stripeSecretKey) {
    problems.push(
      "STRIPE_SECRET_KEY is required when billing is enabled (BILLING_ENABLED=true)",
    );
  }

  // --- transactional email (optional) --------------------------------------
  // Without it, confirmation links are logged instead of sent, which blocks
  // email/password signup but leaves OAuth sign-in working.
  const resendApiKey = trimmed(env.RESEND_API_KEY);
  const emailFrom = trimmed(env.EMAIL_FROM);
  if (resendApiKey && !emailFrom) {
    problems.push(
      'EMAIL_FROM is required when RESEND_API_KEY is set (e.g. "GitLaunch <noreply@acme.com>")',
    );
  }

  // --- analytics -----------------------------------------------------------
  const analyticsEnabled = parseBool(env.ANALYTICS_WAREHOUSE) ?? false;
  let retentionDays: number | undefined;
  const rawRetention = trimmed(env.ANALYTICS_RETENTION_DAYS);
  if (rawRetention !== undefined) {
    const parsed = Number(rawRetention);
    if (!Number.isInteger(parsed) || parsed < 1) {
      problems.push(
        `ANALYTICS_RETENTION_DAYS must be a positive whole number of days (got "${rawRetention}")`,
      );
    } else {
      retentionDays = parsed;
    }
  }

  // --- GitLaunch's own flag reads (dogfooding) -----------------------------
  // A customer install must never phone home to our flag service.
  const selfFlagServiceId = trimmed(env.GITLAUNCH_SERVICE_ID);
  const selfFlagsEnabled = !isSelfHosted && selfFlagServiceId !== undefined;

  // --- build simulation ----------------------------------------------------
  // This fabricates builds in the UI. Harmless locally, actively misleading in
  // a customer's install — so fail loudly rather than quietly ignore it.
  const simulationRequested = parseBool(env.ENABLE_BUILD_SIMULATION) ?? false;
  if (isSelfHosted && simulationRequested) {
    problems.push(
      "ENABLE_BUILD_SIMULATION must be false on a self-hosted build — " +
        "it reports fabricated builds",
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid GitLaunch configuration (${problems.length} problem${
        problems.length === 1 ? "" : "s"
      }):\n` + problems.map((p) => `  - ${p}`).join("\n"),
    );
  }

  return {
    distribution,
    publicUrl: publicUrl!,
    port,
    mongoUri: mongoUri!,
    cookieSecret: cookieSecret!,
    github: {
      enabled: githubEnabled,
      useFakes,
      appId: trimmed(env.GH_APP_ID),
      appName: trimmed(env.GH_APP_NAME),
      clientId: trimmed(env.GH_APP_CLIENT_ID),
      clientSecret: trimmed(env.GH_APP_CLIENT_SECRET),
      privateKey: trimmed(env.GH_APP_PRIVATE_KEY),
    },
    features: {
      billing: {
        enabled: billingEnabled,
        secretKey: stripeSecretKey,
        webhookSecret: trimmed(env.STRIPE_WEBHOOK_SECRET),
        proPriceId: trimmed(env.STRIPE_PRO_PRICE_ID),
        teamPriceId: trimmed(env.STRIPE_TEAM_PRICE_ID),
        successUrl:
          trimmed(env.STRIPE_SUCCESS_URL) ??
          `${publicUrl}/settings/billing?success=true`,
        cancelUrl:
          trimmed(env.STRIPE_CANCEL_URL) ??
          `${publicUrl}/settings/billing?cancelled=true`,
      },
      googleAuth: {
        enabled: googleEnabled,
        useFakes: useFakeGoogle && !isSelfHosted,
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      },
      email: {
        enabled: resendApiKey !== undefined,
        apiKey: resendApiKey,
        from: emailFrom,
      },
      analytics: { enabled: analyticsEnabled, retentionDays },
      flagCache: { redisUrl: trimmed(env.REDIS_URL) },
      selfFlags: {
        enabled: selfFlagsEnabled,
        serviceId: selfFlagServiceId,
      },
      buildSimulation: { enabled: simulationRequested && !isSelfHosted },
    },
  };
}

/**
 * A redacted, human-readable view of what the config actually resolved to.
 * Logged once at boot — the fastest way to answer "why is sign-in with Google
 * missing on my install?" without asking a customer to paste their secrets.
 */
export function summarizeConfig(config: Config): string {
  const onOff = (v: boolean) => (v ? "on" : "off");
  const f = config.features;

  return [
    "GitLaunch configuration",
    `  distribution=${config.distribution}  publicUrl=${config.publicUrl}  port=${config.port}`,
    `  mongo=${redactUri(config.mongoUri)}`,
    `  github=${!config.github.enabled ? "off (no GitHub App configured)" : config.github.useFakes ? "fakes (development)" : `app id=${config.github.appId}`}`,
    `  features: billing=${onOff(f.billing.enabled)}` +
      `  googleAuth=${onOff(f.googleAuth.enabled)}` +
      `  email=${onOff(f.email.enabled)}` +
      `  analytics=${onOff(f.analytics.enabled)}` +
      `  flagCache=${f.flagCache.redisUrl ? "redis" : "in-memory"}` +
      `  selfFlags=${onOff(f.selfFlags.enabled)}` +
      `  buildSimulation=${onOff(f.buildSimulation.enabled)}`,
  ].join("\n");
}
