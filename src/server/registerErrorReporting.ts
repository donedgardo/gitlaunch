import { FastifyInstance } from "fastify";

import { AnalyticsService } from "../services/analytics/analytics";
import { ErrorReporterI } from "../services/observability/errorReporter";

// A statusCode in this range means Fastify (or a plugin like @fastify/static)
// already turned the error into the correct client-facing response — bad
// input, a forbidden path, a missing route. That's expected traffic, not an
// application bug, so it should not be reported as one.
function isHandledClientError(error: { statusCode?: unknown }): boolean {
  const statusCode = error.statusCode;
  return (
    typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
  );
}

// Reports errors thrown while handling a request. An onError hook observes the
// failure without owning the response, so Fastify's error handling (and any
// route-level handling) stays exactly as it was — with reporting off, behaviour
// is identical.
export function registerErrorReporting(
  server: FastifyInstance,
  reporter: ErrorReporterI,
  analytics?: AnalyticsService,
): void {
  server.addHook("onError", async (request, _reply, error) => {
    if (isHandledClientError(error)) return;

    const properties = { method: request.method, url: request.url };
    reporter.captureException(error, properties);
    analytics?.captureException?.(error, properties, {
      accountId: request.session?.accountId,
      distinctId: request.session?.userId,
    });
  });
}
