// Abstraction over crash/error reporting. Callers depend on this interface, not
// on Sentry, so reporting stays optional: with no DSN configured the app runs
// against the no-op and nothing leaves the process.
export interface ErrorReporterI {
  // Whether a backend is actually wired up. Useful for boot logging and for
  // features that want to skip building an expensive context when nobody is
  // listening.
  readonly enabled: boolean;
  captureException(error: unknown, context?: Record<string, unknown>): void;
  // Waits for queued reports to be sent. Call before exiting the process, or a
  // crash report is dropped with the transport still in flight.
  flush(timeoutMs?: number): Promise<void>;
}

// The slice of @sentry/node we use. Declaring it ourselves keeps the SDK an
// optional dependency — the type-checker never needs the package to be present.
export type SentrySdkLike = {
  init(options: Record<string, unknown>): void;
  captureException(
    error: unknown,
    hint?: { extra?: Record<string, unknown> },
  ): void;
  flush?(timeout?: number): Promise<boolean>;
};

// Used when reporting is off (no DSN) or unavailable (SDK not installed).
export class NoOpErrorReporter implements ErrorReporterI {
  public readonly enabled = false;

  captureException(): void {
    // Intentionally does nothing.
  }

  async flush(): Promise<void> {
    // Nothing is queued, so there is nothing to wait for.
  }
}

// Forwards errors to an initialized Sentry SDK. Reporting is best-effort: a
// broken transport must never take down the request that was being served.
export class SentryErrorReporter implements ErrorReporterI {
  public readonly enabled = true;

  constructor(private readonly sdk: SentrySdkLike) {}

  captureException(error: unknown, context?: Record<string, unknown>): void {
    try {
      this.sdk.captureException(
        error,
        context ? { extra: context } : undefined,
      );
    } catch (err) {
      console.warn("[sentry] failed to report an error", err);
    }
  }

  async flush(timeoutMs?: number): Promise<void> {
    try {
      await this.sdk.flush?.(timeoutMs);
    } catch (err) {
      console.warn("[sentry] failed to flush pending reports", err);
    }
  }
}
