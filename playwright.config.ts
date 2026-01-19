import { defineConfig, devices } from "@playwright/test";

// Use a different port for e2e tests to avoid conflicts with dev server
const E2E_PORT = 3051;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.TEST_BASE_URL || `http://localhost:${E2E_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Clear yarn's npm_config_* env vars to avoid npm warnings
    command: `env -u npm_config_version_git_tag -u npm_config_argv -u npm_config_workspaces_experimental -u npm_config_workpsaces_experimental -u npm_config_version_commit_hooks -u npm_config_version_git_message -u npm_config_version_tag_prefix PORT=${E2E_PORT} npx tsx e2e/server.ts`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI, // Always start fresh in CI
    timeout: 30 * 1000,
  },
});
