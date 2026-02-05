import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Workflow Settings E2E Tests
 *
 * WHY THIS MATTERS:
 * ─────────────────
 * Different services may use different GitHub Actions workflows for deployment.
 * Users need to configure which workflow file and event type GitLaunch should
 * trigger when they click "Deploy" in the dashboard.
 *
 * SUCCESS CRITERIA:
 * ─────────────────
 * 1. Users can VIEW their current workflow settings
 * 2. Users can CHANGE the workflow file (e.g., deploy.yml → custom-deploy.yml)
 * 3. Users can CHANGE the event type (e.g., deployment → deploy-staging)
 * 4. Changes PERSIST across page reloads
 */

// Use serial mode because tests modify the same service and depend on order
test.describe.serial("Workflow Settings", () => {
  test("user can view current workflow settings", async ({ page }) => {
    // Given: I am logged in with a service
    await authenticateTestUser(page, TEST_USERS.userWithService);

    // When: I go to service settings
    await page.goto("/services/000000000000000000000203/settings");

    // Then: I should see the workflow configuration section
    await expect(page.getByText(/deployment workflow/i)).toBeVisible();
    await expect(page.locator("#workflowFile")).toBeVisible();
    await expect(page.locator("#eventType")).toBeVisible();

    // Verify default values from test data setup
    await expect(page.locator("#workflowFile")).toHaveValue("deploy.yml");
    await expect(page.locator("#eventType")).toHaveValue("deployment");
  });

  test("user can change workflow file", async ({ page }) => {
    // Given: I am on service settings
    await authenticateTestUser(page, TEST_USERS.userWithService);
    await page.goto("/services/000000000000000000000203/settings");

    // When: I change the workflow file and save
    await page.locator("#workflowFile").clear();
    await page.locator("#workflowFile").fill("custom-deploy.yml");
    await page.getByRole("button", { name: /save workflow/i }).click();

    // Then: I should see a success toast
    await expect(page.getByText(/saved|success/i)).toBeVisible();

    // And: The change persists on reload
    await page.reload();
    await expect(page.locator("#workflowFile")).toHaveValue(
      "custom-deploy.yml",
    );
  });

  test("user can change event type", async ({ page }) => {
    // Given: I am on service settings
    await authenticateTestUser(page, TEST_USERS.userWithService);
    await page.goto("/services/000000000000000000000203/settings");

    // When: I change the event type and save
    await page.locator("#eventType").clear();
    await page.locator("#eventType").fill("deploy-staging");
    await page.getByRole("button", { name: /save workflow/i }).click();

    // Then: I should see a success toast
    await expect(page.getByText(/saved|success/i)).toBeVisible();

    // And: The change persists on reload
    await page.reload();
    await expect(page.locator("#eventType")).toHaveValue("deploy-staging");
  });

  test("user can change both workflow file and event type together", async ({
    page,
  }) => {
    // Given: I am on service settings
    await authenticateTestUser(page, TEST_USERS.userWithService);
    await page.goto("/services/000000000000000000000203/settings");

    // When: I change both settings and save
    await page.locator("#workflowFile").clear();
    await page.locator("#workflowFile").fill("ci-cd.yml");
    await page.locator("#eventType").clear();
    await page.locator("#eventType").fill("trigger-deploy");
    await page.getByRole("button", { name: /save workflow/i }).click();

    // Then: I should see a success toast
    await expect(page.getByText(/saved|success/i)).toBeVisible();

    // And: Both changes persist on reload
    await page.reload();
    await expect(page.locator("#workflowFile")).toHaveValue("ci-cd.yml");
    await expect(page.locator("#eventType")).toHaveValue("trigger-deploy");
  });
});
