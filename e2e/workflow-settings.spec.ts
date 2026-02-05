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

test.describe("Workflow Settings", () => {
  test("user can view current workflow settings", async ({ page }) => {
    // Given: I am logged in with a service
    await authenticateTestUser(page, TEST_USERS.userWithService);

    // When: I go to service settings
    await page.goto("/services/000000000000000000000203/settings");

    // Then: I should see the workflow configuration section
    await expect(page.getByText(/deployment workflow/i)).toBeVisible();
    await expect(page.locator("#workflowFile")).toBeVisible();
    await expect(page.locator("#eventType")).toBeVisible();
  });

  test("user can change workflow file", async ({ page }) => {
    // Given: I am on service settings
    await authenticateTestUser(page, TEST_USERS.userWithService);
    await page.goto("/services/000000000000000000000203/settings");

    // When: I change the workflow file and save
    await page.locator("#workflowFile").fill("custom-deploy.yml");
    await page.getByRole("button", { name: /save workflow/i }).click();

    // Then: I should see a success message
    await expect(page.getByText(/saved|updated|success/i)).toBeVisible();

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
    await page.locator("#eventType").fill("deploy-to-staging");
    await page.getByRole("button", { name: /save workflow/i }).click();

    // Then: I should see a success message
    await expect(page.getByText(/saved|updated|success/i)).toBeVisible();

    // And: The change persists on reload
    await page.reload();
    await expect(page.locator("#eventType")).toHaveValue("deploy-to-staging");
  });

  test("workflow settings show default values for new service", async ({
    page,
  }) => {
    // Given: I have a service with default workflow settings
    await authenticateTestUser(page, TEST_USERS.userWithService);

    // When: I go to settings
    await page.goto("/services/000000000000000000000203/settings");

    // Then: I should see the default values (or current configured values)
    const workflowFile = await page.locator("#workflowFile").inputValue();
    const eventType = await page.locator("#eventType").inputValue();

    // Values should not be empty
    expect(workflowFile.length).toBeGreaterThan(0);
    expect(eventType.length).toBeGreaterThan(0);
  });
});
