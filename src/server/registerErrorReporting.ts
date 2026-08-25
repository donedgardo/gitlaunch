import { FastifyInstance } from "fastify";

import { AnalyticsService } from "../services/analytics/analytics";
import { ErrorReporterI } from "../services/observability/errorReporter";

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
    const properties = { method: request.method, url: request.url };
    reporter.captureException(error, properties);
    analytics?.captureException?.(error, properties, {
      accountId: request.session?.accountId,
      distinctId: request.session?.userId,
    });
  });
}
