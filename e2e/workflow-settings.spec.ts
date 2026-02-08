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
 * 5. Workflow dropdown POPULATES with workflows from GitHub
 * 6. Dropdown PRE-SELECTS the currently configured workflow
 */

// Use serial mode because tests modify the same service and depend on order
test.describe.serial("Workflow Settings", () => {
  test("user can view current workflow settings", async ({ page }) => {
    // Given: I am logged in with a service
    await authenticateTestUser(page, TEST_USERS.userWithService);

    // When: I go to service settings
    await page.goto("/services/000000000000000000000203/settings");

    // Then: I should see the workflow configuration section
    await expect(
      page.getByRole("heading", { name: "Deployment Workflow", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#workflowFile")).toBeVisible();
    await expect(page.locator("#eventType")).toBeVisible();

    // Wait for HTMX to load the options
    await page.waitForFunction(() => {
      const select = document.querySelector(
        "#workflowFile",
      ) as HTMLSelectElement;
      return (
        select &&
        select.options.length > 0 &&
        !select.innerHTML.includes("Loading")
      );
    });

    // Verify default values from test data setup
    await expect(page.locator("#workflowFile")).toHaveValue("deploy.yml");
    await expect(page.locator("#eventType")).toHaveValue("deployment");
  });

  test("workflow dropdown is a select element that loads from GitHub", async ({
    page,
  }) => {
    // Given: I am logged in with a service
    await authenticateTestUser(page, TEST_USERS.userWithService);

    // When: I go to service settings
    await page.goto("/services/000000000000000000000203/settings");

    // Then: The workflowFile element should be a <select> dropdown
    const workflowSelect = page.locator("#workflowFile");
    await expect(workflowSelect).toBeVisible();

    // Verify it's a select element (not an input)
    const tagName = await workflowSelect.evaluate((el) =>
      el.tagName.toLowerCase(),
    );
    expect(tagName).toBe("select");

    // Wait for HTMX to load the options
    await page.waitForFunction(() => {
      const select = document.querySelector(
        "#workflowFile",
      ) as HTMLSelectElement;
      return (
        select &&
        select.options.length > 0 &&
        !select.innerHTML.includes("Loading")
      );
    });

    // Verify the dropdown contains workflow options from the mock
    const options = workflowSelect.locator("option");
    await expect(options).not.toHaveCount(0);
  });

  test("workflow dropdown pre-selects the current workflow value", async ({
    page,
  }) => {
    // Given: I am logged in with a service that has deploy.yml configured
    await authenticateTestUser(page, TEST_USERS.userWithService);

    // When: I go to service settings
    await page.goto("/services/000000000000000000000203/settings");

    // Wait for HTMX to load the options
    await page.waitForFunction(() => {
      const select = document.querySelector(
        "#workflowFile",
      ) as HTMLSelectElement;
      return (
        select &&
        select.options.length > 0 &&
        !select.innerHTML.includes("Loading")
      );
    });

    // Then: The dropdown should have deploy.yml selected
    await expect(page.locator("#workflowFile")).toHaveValue("deploy.yml");
  });

  test("user can change workflow file using dropdown", async ({ page }) => {
    // Given: I am on service settings
    await authenticateTestUser(page, TEST_USERS.userWithService);
    await page.goto("/services/000000000000000000000203/settings");

    // Wait for HTMX to load the options
    await page.waitForFunction(() => {
      const select = document.querySelector(
        "#workflowFile",
      ) as HTMLSelectElement;
      return (
        select &&
        select.options.length > 0 &&
        !select.innerHTML.includes("Loading")
      );
    });

    // When: I select a different workflow from the dropdown and save
    await page.locator("#workflowFile").selectOption("ci.yml");
    await page.getByRole("button", { name: /save workflow/i }).click();

    // Then: I should see a success toast
    await expect(page.getByText("Workflow settings saved")).toBeVisible();

    // And: The change persists on reload
    await page.reload();

    // Wait for options to load again
    await page.waitForFunction(() => {
      const select = document.querySelector(
        "#workflowFile",
      ) as HTMLSelectElement;
      return (
        select &&
        select.options.length > 0 &&
        !select.innerHTML.includes("Loading")
      );
    });

    await expect(page.locator("#workflowFile")).toHaveValue("ci.yml");
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
    await expect(page.getByText("Workflow settings saved")).toBeVisible();

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

    // Wait for HTMX to load the options
    await page.waitForFunction(() => {
      const select = document.querySelector(
        "#workflowFile",
      ) as HTMLSelectElement;
      return (
        select &&
        select.options.length > 0 &&
        !select.innerHTML.includes("Loading")
      );
    });

    // When: I change both settings and save
    // NOTE: Reset to original values so serial tests can run again
    await page.locator("#workflowFile").selectOption("deploy.yml");
    await page.locator("#eventType").clear();
    await page.locator("#eventType").fill("deployment");
    await page.getByRole("button", { name: /save workflow/i }).click();

    // Then: I should see a success toast
    await expect(page.getByText("Workflow settings saved")).toBeVisible();

    // And: Both changes persist on reload
    await page.reload();

    // Wait for options to load again
    await page.waitForFunction(() => {
      const select = document.querySelector(
        "#workflowFile",
      ) as HTMLSelectElement;
      return (
        select &&
        select.options.length > 0 &&
        !select.innerHTML.includes("Loading")
      );
    });

    await expect(page.locator("#workflowFile")).toHaveValue("deploy.yml");
    await expect(page.locator("#eventType")).toHaveValue("deployment");
  });
});
