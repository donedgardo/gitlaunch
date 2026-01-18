import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3050",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "E2E_TEST_MODE=true npx tsx src/index.ts",
    url: "http://localhost:3050",
    reuseExistingServer: true,
    timeout: 30 * 1000,
    env: {
      E2E_TEST_MODE: "true",
    },
  },
});
