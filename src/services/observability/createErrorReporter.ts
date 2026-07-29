import {
  ErrorReporterI,
  NoOpErrorReporter,
  SentryErrorReporter,
  SentrySdkLike,
} from "./errorReporter";

export type SentrySdkLoader = () => SentrySdkLike;

// eval("require") hides the specifier from the type-checker/bundler so an
// uninstalled @sentry/node doesn't break the build; it throws at runtime only
// when reporting is actually requested, and we degrade gracefully below. Same
// approach as the optional ioredis load in createFlagCache.
const loadSentrySdk: SentrySdkLoader = () => {
  const optionalRequire = eval("require") as NodeRequire;
  return optionalRequire("@sentry/node") as SentrySdkLike;
};

function parseSampleRate(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const rate = Number(value);
  if (Number.isFinite(rate)) return rate;
  console.warn(
    `[sentry] ignoring SENTRY_TRACES_SAMPLE_RATE="${value}" — not a number.`,
  );
  return undefined;
}

// Build the error reporter from the environment. Sentry is opt-in: set
// SENTRY_DSN and the SDK is registered at boot; leave it blank and the app uses
// a no-op reporter, so the feature costs nothing when unused.
export function createErrorReporter(
  env: NodeJS.ProcessEnv = process.env,
  loadSdk: SentrySdkLoader = loadSentrySdk,
): ErrorReporterI {
  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    return new NoOpErrorReporter();
  }

  let sdk: SentrySdkLike;
  try {
    sdk = loadSdk();
  } catch (err) {
    console.warn(
      "[sentry] SENTRY_DSN is set but @sentry/node could not be loaded; " +
        "error reporting is disabled. Run `yarn add @sentry/node` to enable it.",
      err,
    );
    return new NoOpErrorReporter();
  }

  const environment = env.SENTRY_ENVIRONMENT || env.NODE_ENV || "development";
  try {
    sdk.init({
      dsn,
      environment,
      release: env.SENTRY_RELEASE,
      tracesSampleRate: parseSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
    });
  } catch (err) {
    console.warn(
      "[sentry] failed to initialize the SDK; error reporting is disabled.",
      err,
    );
    return new NoOpErrorReporter();
  }

  console.info(`[sentry] error reporting enabled (environment=${environment})`);
  return new SentryErrorReporter(sdk);
}
