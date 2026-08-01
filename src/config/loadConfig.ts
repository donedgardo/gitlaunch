// Single source of truth for GitLaunch's runtime configuration.
//
// Why this exists: GitLaunch is now shipped two ways — as our hosted SaaS and
// as a self-hosted enterprise install a customer runs in their own cluster.
// Those two deployments want different things switched on. Reading
// `process.env` ad hoc at a dozen call sites makes that difference invisible
// and lets a misconfigured on-prem install boot "successfully" with features
// silently missing.
//
// So: every setting is declared here, validated once at boot, and every
// problem is reported together. An operator fixes their values file in one
// pass instead of one restart per missing variable.

export type Edition = "saas" | "enterprise";

export type Config = {
  edition: Edition;
  publicUrl: string;
  port: number;
  mongoUri: string;
  cookieSecret: string;
  github: {
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
    analytics: { enabled: boolean; retentionDays?: number };
    flagCache: { redisUrl?: string };
    selfFlags: { enabled: boolean; serviceId?: string; environment: string };
    buildSimulation: { enabled: boolean };
  };
};

const EDITIONS: Edition[] = ["saas", "enterprise"];

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
 * Build the validated runtime config from an environment.
 *
 * Throws a single Error listing every problem found, so an operator sees the
 * whole picture at once.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  // --- edition -------------------------------------------------------------
  const rawEdition = trimmed(env.GITLAUNCH_EDITION) ?? "saas";
  const isKnownEdition = (EDITIONS as string[]).includes(rawEdition);
  if (!isKnownEdition) {
    problems.push(
      `GITLAUNCH_EDITION must be one of ${EDITIONS.join(" | ")} (got "${rawEdition}")`,
    );
  }
  // Fall back to saas so the remaining checks still produce useful output.
  const edition: Edition = isKnownEdition ? (rawEdition as Edition) : "saas";
  const isEnterprise = edition === "enterprise";

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

  // --- github --------------------------------------------------------------
  const useFakes = parseBool(env.USE_FAKE_GITHUB) ?? false;
  if (isEnterprise && useFakes) {
    problems.push(
      "USE_FAKE_GITHUB must be false in the enterprise edition — " +
        "fakes are a development affordance and would ship a product that does nothing",
    );
  }
  if (!useFakes) {
    if (!trimmed(env.GH_APP_ID))
      problems.push("GH_APP_ID is required when USE_FAKE_GITHUB is false");
    if (!trimmed(env.GH_APP_CLIENT_ID))
      problems.push(
        "GH_APP_CLIENT_ID is required when USE_FAKE_GITHUB is false",
      );
    if (!trimmed(env.GH_APP_CLIENT_SECRET))
      problems.push(
        "GH_APP_CLIENT_SECRET is required when USE_FAKE_GITHUB is false",
      );
    if (!trimmed(env.GH_APP_PRIVATE_KEY))
      problems.push(
        "GH_APP_PRIVATE_KEY is required when USE_FAKE_GITHUB is false",
      );
  }

  // --- billing -------------------------------------------------------------
  // Enterprise is licensed, not per-seat billed. A Stripe key left over in a
  // copied env file must not silently expose billing routes to a customer, so
  // enterprise stays off unless someone opts in on purpose.
  const stripeSecretKey = trimmed(env.STRIPE_SECRET_KEY);
  const billingOverride = parseBool(env.BILLING_ENABLED);
  const billingEnabled =
    billingOverride ?? (!isEnterprise && stripeSecretKey !== undefined);

  if (billingEnabled && !stripeSecretKey) {
    problems.push(
      "STRIPE_SECRET_KEY is required when billing is enabled (BILLING_ENABLED=true)",
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
  const selfFlagsEnabled = !isEnterprise && selfFlagServiceId !== undefined;

  // --- build simulation ----------------------------------------------------
  // This fabricates fake builds in the UI. Harmless locally, actively
  // misleading in a customer's install — so fail loudly rather than ignore it.
  const simulationRequested = parseBool(env.ENABLE_BUILD_SIMULATION) ?? false;
  if (isEnterprise && simulationRequested) {
    problems.push(
      "ENABLE_BUILD_SIMULATION must be false in the enterprise edition — " +
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
    edition,
    publicUrl: publicUrl!,
    port,
    mongoUri: mongoUri!,
    cookieSecret: cookieSecret!,
    github: {
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
      analytics: { enabled: analyticsEnabled, retentionDays },
      flagCache: { redisUrl: trimmed(env.REDIS_URL) },
      selfFlags: {
        enabled: selfFlagsEnabled,
        serviceId: selfFlagServiceId,
        environment: trimmed(env.GITLAUNCH_FLAG_ENV) ?? "prod",
      },
      buildSimulation: { enabled: simulationRequested && !isEnterprise },
    },
  };
}

/**
 * A redacted, human-readable view of what the config actually resolved to.
 * Logged once at boot — the fastest way to answer "why is billing missing on
 * my install?" without asking a customer to paste their secrets.
 */
export function summarizeConfig(config: Config): string {
  const onOff = (v: boolean) => (v ? "on" : "off");
  const f = config.features;

  return [
    "GitLaunch configuration",
    `  edition=${config.edition}  publicUrl=${config.publicUrl}  port=${config.port}`,
    `  mongo=${redactUri(config.mongoUri)}`,
    `  github=${config.github.useFakes ? "fakes (development)" : `app id=${config.github.appId}`}`,
    `  features: billing=${onOff(f.billing.enabled)}` +
      `  analytics=${onOff(f.analytics.enabled)}` +
      `  flagCache=${f.flagCache.redisUrl ? "redis" : "in-memory"}` +
      `  selfFlags=${onOff(f.selfFlags.enabled)}` +
      `  buildSimulation=${onOff(f.buildSimulation.enabled)}`,
  ].join("\n");
}
