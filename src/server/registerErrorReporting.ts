import { FastifyInstance } from "fastify";

import { ErrorReporterI } from "../services/observability/errorReporter";

// Reports errors thrown while handling a request. An onError hook observes the
// failure without owning the response, so Fastify's error handling (and any
// route-level handling) stays exactly as it was — with reporting off, behaviour
// is identical.
export function registerErrorReporting(
  server: FastifyInstance,
  reporter: ErrorReporterI,
): void {
  server.addHook("onError", async (request, _reply, error) => {
    reporter.captureException(error, {
      method: request.method,
      url: request.url,
    });
  });
}
