import { describe, it, expect } from "vitest";

import { createErrorReporter } from "./createErrorReporter";
import { SentrySdkLike } from "./errorReporter";

// Contract-based fake of the Sentry SDK (an external service), recording what
// the app asked it to do.
function fakeSdk() {
  const initOptions: Record<string, unknown>[] = [];
  const captured: { error: unknown; extra?: Record<string, unknown> }[] = [];
  const flushes: (number | undefined)[] = [];
  const sdk: SentrySdkLike = {
    init: (options) => {
      initOptions.push(options);
    },
    captureException: (error, hint) => {
      captured.push({ error, extra: hint?.extra });
    },
    flush: async (timeout) => {
      flushes.push(timeout);
      return true;
    },
  };
  return { sdk, initOptions, captured, flushes };
}

describe("createErrorReporter", () => {
  it("should not register the sentry sdk when no DSN is configured", () => {
    const { sdk, initOptions } = fakeSdk();

    const reporter = createErrorReporter({} as NodeJS.ProcessEnv, () => sdk);
    reporter.captureException(new Error("boom"));

    expect(initOptions).toHaveLength(0);
    expect(reporter.enabled).toBe(false);
  });

  it("should register the sentry sdk with the configured DSN when enabled", () => {
    const { sdk, initOptions } = fakeSdk();

    const reporter = createErrorReporter(
      {
        SENTRY_DSN: "https://key@example.ingest.sentry.io/42",
        SENTRY_ENVIRONMENT: "staging",
        SENTRY_RELEASE: "gitlaunch@1.2.3",
      } as NodeJS.ProcessEnv,
      () => sdk,
    );

    expect(reporter.enabled).toBe(true);
    expect(initOptions).toHaveLength(1);
    expect(initOptions[0]).toMatchObject({
      dsn: "https://key@example.ingest.sentry.io/42",
      environment: "staging",
      release: "gitlaunch@1.2.3",
    });
  });

  it("should fall back to NODE_ENV for the environment when SENTRY_ENVIRONMENT is unset", () => {
    const { sdk, initOptions } = fakeSdk();

    createErrorReporter(
      {
        SENTRY_DSN: "https://key@example.ingest.sentry.io/42",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv,
      () => sdk,
    );

    expect(initOptions[0]).toMatchObject({ environment: "production" });
  });

  it("should sample traces only when a rate is configured", () => {
    const withoutRate = fakeSdk();
    createErrorReporter(
      {
        SENTRY_DSN: "https://key@example.ingest.sentry.io/42",
      } as NodeJS.ProcessEnv,
      () => withoutRate.sdk,
    );
    expect(withoutRate.initOptions[0].tracesSampleRate).toBeUndefined();

    const withRate = fakeSdk();
    createErrorReporter(
      {
        SENTRY_DSN: "https://key@example.ingest.sentry.io/42",
        SENTRY_TRACES_SAMPLE_RATE: "0.25",
      } as NodeJS.ProcessEnv,
      () => withRate.sdk,
    );
    expect(withRate.initOptions[0].tracesSampleRate).toBe(0.25);
  });

  it("should send captured errors to sentry when enabled", () => {
    const { sdk, captured } = fakeSdk();
    const reporter = createErrorReporter(
      {
        SENTRY_DSN: "https://key@example.ingest.sentry.io/42",
      } as NodeJS.ProcessEnv,
      () => sdk,
    );

    const error = new Error("dispatch failed");
    reporter.captureException(error, { url: "/api/v1/builds" });

    expect(captured).toHaveLength(1);
    expect(captured[0].error).toBe(error);
    expect(captured[0].extra).toEqual({ url: "/api/v1/builds" });
  });

  it("should flush pending reports so a crashing process still delivers them", async () => {
    const { sdk, flushes } = fakeSdk();
    const reporter = createErrorReporter(
      {
        SENTRY_DSN: "https://key@example.ingest.sentry.io/42",
      } as NodeJS.ProcessEnv,
      () => sdk,
    );

    await reporter.flush(2000);

    expect(flushes).toEqual([2000]);
  });

  it("should resolve flush even when reporting is disabled", async () => {
    const reporter = createErrorReporter({} as NodeJS.ProcessEnv, () => {
      throw new Error("should not be loaded");
    });

    await expect(reporter.flush()).resolves.toBeUndefined();
  });

  it("should resolve flush when the sdk fails to flush", async () => {
    const reporter = createErrorReporter(
      {
        SENTRY_DSN: "https://key@example.ingest.sentry.io/42",
      } as NodeJS.ProcessEnv,
      () => ({
        init: () => {},
        captureException: () => {},
        flush: async () => {
          throw new Error("sentry transport is down");
        },
      }),
    );

    await expect(reporter.flush()).resolves.toBeUndefined();
  });

  it("should stay disabled when a DSN is set but the sdk is not installed", () => {
    const reporter = createErrorReporter(
      {
        SENTRY_DSN: "https://key@example.ingest.sentry.io/42",
      } as NodeJS.ProcessEnv,
      () => {
        throw new Error("Cannot find module '@sentry/node'");
      },
    );

    expect(reporter.enabled).toBe(false);
    // Reporting must never throw, even when the SDK failed to load.
    expect(() => reporter.captureException(new Error("boom"))).not.toThrow();
  });

  it("should keep serving when the sdk itself throws while capturing", () => {
    const reporter = createErrorReporter(
      {
        SENTRY_DSN: "https://key@example.ingest.sentry.io/42",
      } as NodeJS.ProcessEnv,
      () => ({
        init: () => {},
        captureException: () => {
          throw new Error("sentry transport is down");
        },
      }),
    );

    expect(() => reporter.captureException(new Error("boom"))).not.toThrow();
  });
});
