import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/**
 * MSW server instance for intercepting HTTP requests during e2e tests.
 * This runs in Node.js and intercepts server-side HTTP requests.
 */
export const mswServer = setupServer(...handlers);
