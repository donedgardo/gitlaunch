/**
 * E2E Test Server Bootstrap
 *
 * This script starts MSW to intercept external HTTP requests (GitHub API),
 * then starts the REAL production server. This approach:
 *
 * 1. Tests the actual production server code (src/index.ts)
 * 2. Keeps production code 100% clean of test-specific logic
 * 3. Controls external dependencies via network-level mocking
 *
 * MSW intercepts HTTP requests at the Node.js level, so the production
 * server code makes real HTTP calls that get intercepted and mocked.
 */
import { mswServer } from "./mocks/server";

// Start MSW before importing the production server
mswServer.listen({
  onUnhandledRequest: "bypass", // Allow unmocked requests to pass through
});

console.info("MSW started - intercepting GitHub API requests");

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
