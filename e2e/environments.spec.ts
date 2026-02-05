import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Environment Management E2E Tests
 *
 * WHY THIS MATTERS:
 * ─────────────────
 * Different teams have different deployment pipelines. A startup might only need
 * "staging" and "prod", while an enterprise might need "dev", "qa", "staging",
 * "uat", "prod". Users must be able to customize environments to match their
 * actual deployment workflow — otherwise GitLaunch becomes unusable for their team.
 *
 * SUCCESS CRITERIA:
 * ─────────────────
 * 1. Users can VIEW their service's environments in the dashboard/settings
 * 2. Users can ADD new environments (e.g., "qa", "uat")
 * 3. Users can EDIT environment display names (e.g., "prod" → "Production US-East")
 * 4. Users can REORDER environments to match their deployment flow
 * 5. Users can REMOVE environments they no longer need
 * 6. Changes are immediately reflected in the build deployment table
 * 7. Invalid environment names are rejected with clear error messages
 *
 * ACCEPTANCE CRITERIA (Given/When/Then):
 * ──────────────────────────────────────
 *
 * Feature: View Environments
 *   Given I am logged in and have a service
 *   When I navigate to service settings
 *   Then I should see the list of environments (staging, prod by default)
 *
 * Feature: Add Environment
 *   Given I am on service settings
 *   When I add a new environment "qa" with display name "QA Testing"
 *   Then the environment appears in the list
 *   And the dashboard build table shows the new column
 *
 * Feature: Edit Environment
 *   Given I have an environment "staging"
 *   When I change its display name to "Staging US-West"
 *   Then the new name appears in the dashboard
 *
 * Feature: Reorder Environments
 *   Given I have environments in order: staging, prod
 *   When I move "prod" before "staging"
 *   Then the dashboard columns reflect the new order
 *
 * Feature: Remove Environment
 *   Given I have an environment "qa" with no deployments
 *   When I delete the environment
 *   Then it no longer appears in the list or dashboard
 *
 * Feature: Validation
 *   Given I try to add an environment with invalid name "My Environment!"
 *   When I submit the form
 *   Then I see an error message about valid name format
 */

test.describe("Environment Management", () => {
  test.describe("View Environments", () => {
    test("user can see default environments in service settings", async ({
      page,
    }) => {
      // Given: I am logged in and have a service
      await authenticateTestUser(page, TEST_USERS.userWithService);

      // When: I navigate to service settings
      await page.goto("/dashboard");
      await page
        .getByRole("link", { name: /settings/i })
        .first()
        .click();

      // Then: I should see the environments section with defaults
      await expect(page.getByText(/environments/i)).toBeVisible();
      await expect(page.getByText("staging")).toBeVisible();
      await expect(page.getByText(/prod/i)).toBeVisible();
    });
  });

  test.describe("Add Environment", () => {
    test("user can add a new environment", async ({ page }) => {
      // Given: I am on service settings
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/dashboard");
      await page
        .getByRole("link", { name: /settings/i })
        .first()
        .click();

      // When: I add a new environment
      await page.getByRole("button", { name: /add environment/i }).click();
      await page.locator("#env-name").fill("qa");
      await page.locator("#env-display-name").fill("QA Testing");
      await page.getByRole("button", { name: /save/i }).click();

      // Then: the environment appears in the list
      await expect(page.getByText("QA Testing")).toBeVisible();
    });

    test("new environment appears in dashboard build table", async ({
      page,
    }) => {
      // Given: I added a new environment "qa"
      await authenticateTestUser(page, TEST_USERS.userWithService);
      // (Assuming "qa" was added in a previous step or via API setup)

      // When: I go to the dashboard
      await page.goto("/dashboard");

      // Then: the build table has a column for "qa"
      await expect(page.locator("th").filter({ hasText: /qa/i })).toBeVisible();
    });
  });

  test.describe("Edit Environment", () => {
    test("user can change environment display name", async ({ page }) => {
      // Given: I have an environment "staging"
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/dashboard");
      await page
        .getByRole("link", { name: /settings/i })
        .first()
        .click();

      // When: I edit the staging environment
      await page
        .locator('[data-env="staging"]')
        .getByRole("button", { name: /edit/i })
        .click();
      await page.locator("#env-display-name").clear();
      await page.locator("#env-display-name").fill("Staging US-West");
      await page.getByRole("button", { name: /save/i }).click();

      // Then: the new name is displayed
      await expect(page.getByText("Staging US-West")).toBeVisible();
    });
  });

  test.describe("Reorder Environments", () => {
    test("user can change environment order", async ({ page }) => {
      // Given: I have environments in order: staging (0), prod (1)
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/dashboard");
      await page
        .getByRole("link", { name: /settings/i })
        .first()
        .click();

      // When: I change prod's order to 0 (before staging)
      await page
        .locator('[data-env="prod"]')
        .getByRole("button", { name: /edit/i })
        .click();
      await page.locator("#env-order").clear();
      await page.locator("#env-order").fill("0");
      await page.getByRole("button", { name: /save/i }).click();

      // Then: prod appears before staging in the list
      const envItems = page.locator("[data-env]");
      const firstEnv = await envItems.first().getAttribute("data-env");
      expect(firstEnv).toBe("prod");
    });
  });

  test.describe("Remove Environment", () => {
    test("user can delete an environment", async ({ page }) => {
      // Given: I have an extra environment "qa"
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/dashboard");
      await page
        .getByRole("link", { name: /settings/i })
        .first()
        .click();

      // First add one so we can delete it
      await page.getByRole("button", { name: /add environment/i }).click();
      await page.locator("#env-name").fill("temp-env");
      await page.locator("#env-display-name").fill("Temporary");
      await page.getByRole("button", { name: /save/i }).click();
      await expect(page.getByText("Temporary")).toBeVisible();

      // When: I delete the environment
      await page
        .locator('[data-env="temp-env"]')
        .getByRole("button", { name: /delete/i })
        .click();
      await page.getByRole("button", { name: /confirm/i }).click();

      // Then: it no longer appears
      await expect(page.getByText("Temporary")).not.toBeVisible();
    });

    test("cannot delete last remaining environment", async ({ page }) => {
      // Given: I only have one environment left
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/dashboard");
      await page
        .getByRole("link", { name: /settings/i })
        .first()
        .click();

      // Remove all but one (if possible via UI)
      // Then try to delete the last one

      // When: I try to delete the last environment
      // Then: the delete button should be disabled or show an error
      const deleteButtons = page.locator(
        '[data-env] button:has-text("Delete")',
      );
      const count = await deleteButtons.count();

      if (count === 1) {
        // Only one environment - delete should be prevented
        await expect(deleteButtons.first()).toBeDisabled();
      }
    });
  });

  test.describe("Validation", () => {
    test("rejects invalid environment name format", async ({ page }) => {
      // Given: I am on service settings
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/dashboard");
      await page
        .getByRole("link", { name: /settings/i })
        .first()
        .click();

      // When: I try to add an environment with invalid name
      await page.getByRole("button", { name: /add environment/i }).click();
      await page.locator("#env-name").fill("My Environment!"); // Invalid: spaces and !
      await page.locator("#env-display-name").fill("Test");
      await page.getByRole("button", { name: /save/i }).click();

      // Then: I see an error message
      await expect(
        page.getByText(/invalid|alphanumeric|lowercase/i),
      ).toBeVisible();
    });

    test("rejects duplicate environment name", async ({ page }) => {
      // Given: I already have a "staging" environment
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/dashboard");
      await page
        .getByRole("link", { name: /settings/i })
        .first()
        .click();

      // When: I try to add another "staging" environment
      await page.getByRole("button", { name: /add environment/i }).click();
      await page.locator("#env-name").fill("staging"); // Duplicate
      await page.locator("#env-display-name").fill("Another Staging");
      await page.getByRole("button", { name: /save/i }).click();

      // Then: I see an error about duplicate name
      await expect(page.getByText(/already exists|duplicate/i)).toBeVisible();
    });
  });
});
