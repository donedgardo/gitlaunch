// Error reporting, registered before anything else the app imports.
//
// IMPORTANT: this module must be the first import in src/index.ts, and the
// imports below must stay in this order. The Sentry SDK instruments libraries
// (http, mongodb) as they are loaded, so anything required before init() is
// never patched — tracing and request context would silently do nothing. dotenv
// comes first because the DSN that decides whether to register at all is read
// from .env.
import "dotenv/config";

import { createErrorReporter } from "./services/observability/createErrorReporter";

// Registers the Sentry SDK when SENTRY_DSN is set; a no-op reporter otherwise.
export const errorReporter = createErrorReporter();
