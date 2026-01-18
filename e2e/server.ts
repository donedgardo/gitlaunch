/**
 * E2E Test Server Bootstrap
 *
 * This script starts the REAL production server with minimal mocking:
 *
 * 1. Mocks jsonwebtoken to avoid RSA key validation (CI uses dummy keys)
 * 2. Uses MSW to intercept GitHub API HTTP requests
 * 3. Tests the actual production server code (src/index.ts)
 * 4. Keeps production code 100% clean of test-specific logic
 *
 * The mocking happens at the module/network level, so production code
 * is unchanged and runs exactly as it would in production.
 */

// Mock jsonwebtoken RS256 signing BEFORE any other imports
// This is necessary because CI uses a dummy GH_APP_PRIVATE_KEY that
// would cause jwt.sign() to crash with RS256 algorithm.
// We only mock RS256 signing; HMAC operations (session tokens) work normally.
import Module from "module";
import originalJwt from "jsonwebtoken";

const originalLoad = (Module as any)._load;
(Module as any)._load = function (
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "jsonwebtoken") {
    return {
      ...originalJwt,
      sign: (
        payload: unknown,
        secretOrPrivateKey: unknown,
        options?: { algorithm?: string },
      ) => {
        // Only mock RS256 signing (GitHub App JWT)
        if (options?.algorithm === "RS256") {
          return "mock-jwt-token-for-e2e-tests";
        }
        // All other signing (HMAC for session tokens) uses real jwt
        return (originalJwt.sign as Function)(
          payload,
          secretOrPrivateKey,
          options,
        );
      },
    };
  }
  return originalLoad.apply(this, [request, parent, isMain]);
};

import { mswServer } from "./mocks/server";

// Start MSW before importing the production server
mswServer.listen({
  onUnhandledRequest: "bypass", // Allow unmocked requests to pass through
});

console.info("MSW started - intercepting GitHub API requests");
console.info("jsonwebtoken mocked - bypassing RSA key validation");

// Now import and run the production server
// Using dynamic import to ensure MSW is ready before any HTTP clients are created
import("../src/index").catch((err) => {
  console.error("Failed to start server:", err);
  mswServer.close();
  process.exit(1);
});

// Cleanup on exit
process.on("SIGINT", () => {
  mswServer.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  mswServer.close();
  process.exit(0);
});
