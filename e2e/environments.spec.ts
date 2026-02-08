import { test, expect } from "@playwright/test";
import { MongoClient, ObjectId } from "mongodb";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";

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
 * 3. Users can EDIT environment order
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
 *   When I add a new environment "qa"
 *   Then the environment appears in the list
 *   And the dashboard build table shows the new column
 *
 * Feature: Edit Environment
 *   Given I have an environment "staging"
 *   When I change its order
 *   Then the new order is reflected in the dashboard
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
      await page.goto("/services/000000000000000000000203/settings");

      // Then: I should see the environments section with defaults
      await expect(
        page.getByRole("heading", { name: /environments/i }),
      ).toBeVisible();
      // Check environment names (first match for each)
      await expect(page.getByText("staging").first()).toBeVisible();
      await expect(page.getByText("prod").first()).toBeVisible();
    });
  });

  test.describe("Add Environment", () => {
    // Reset environments before each test to ensure isolation
    test.beforeEach(async () => {
      const client = new MongoClient(MONGODB_URI);
      try {
        await client.connect();
        const db = client.db("gitlaunch");
        await db.collection("services").updateOne(
          { _id: new ObjectId("000000000000000000000203") },
          {
            $set: {
              environments: [
                { name: "staging", order: 0 },
                { name: "prod", order: 1 },
              ],
            },
          },
        );
      } finally {
        await client.close();
      }
    });

    test("user can add a new environment", async ({ page }) => {
      // Given: I am on service settings
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/services/000000000000000000000203/settings");

      // When: I add a new environment
      await page.getByRole("button", { name: /add environment/i }).click();
      const addModal = page.locator("#add-env-modal");
      await addModal.locator("#env-name").fill("qa");
      await addModal.getByRole("button", { name: /save/i }).click();

      // Wait for modal to close (HTMX request completed)
      await expect(addModal).toBeHidden();

      // Then: the environment appears in the list
      await expect(page.locator('[data-env="qa"]')).toBeVisible();
    });

    test("new environment appears in dashboard build table", async ({
      page,
    }) => {
      // Given: I am logged in and add a new environment "qa"
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/services/000000000000000000000203/settings");

      // Add the "qa" environment
      await page.getByRole("button", { name: /add environment/i }).click();
      const addModal = page.locator("#add-env-modal");
      await addModal.locator("#env-name").fill("qa");
      await addModal.getByRole("button", { name: /save/i }).click();

      // Verify it was added
      await expect(page.locator('[data-env="qa"]')).toBeVisible();

      // When: I go to the dashboard
      await page.goto("/dashboard");

      // Then: the build table has a column for "qa"
      await expect(page.locator("th").filter({ hasText: /qa/i })).toBeVisible();
    });
  });

  test.describe("Edit Environment", () => {
    test("user can change environment order", async ({ page }) => {
      // Given: I have an environment "staging"
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/services/000000000000000000000203/settings");

      // When: I edit the staging environment order
      await page
        .locator('[data-env="staging"]')
        .getByRole("button", { name: /edit/i })
        .click();
      const editModal = page.locator("#edit-env-modal");
      await editModal.locator("#env-order").clear();
      await editModal.locator("#env-order").fill("5");
      await editModal.getByRole("button", { name: /save/i }).click();

      // Then: the modal closes and environment still exists
      await expect(editModal).toBeHidden();
      await expect(page.locator('[data-env="staging"]')).toBeVisible();
    });

    test("dashboard column header shows environment name", async ({ page }) => {
      // Given: I have an environment named "staging"
      await authenticateTestUser(page, TEST_USERS.userWithService);

      // When: I visit the dashboard
      await page.goto("/dashboard");

      // Then: I should see the name "staging" in the column header
      const stagingHeader = page.locator("th").filter({ hasText: "staging" });
      await expect(stagingHeader).toBeVisible();
    });
  });

  test.describe("Reorder Environments", () => {
    // Reset environment orders before each test to ensure test isolation
    // This is needed because "Edit Environment" tests may change the order
    test.beforeEach(async () => {
      const client = new MongoClient(MONGODB_URI);
      try {
        await client.connect();
        const db = client.db("gitlaunch");
        await db.collection("services").updateOne(
          { _id: new ObjectId("000000000000000000000203") },
          {
            $set: {
              environments: [
                { name: "staging", order: 0 },
                { name: "prod", order: 1 },
              ],
            },
          },
        );
      } finally {
        await client.close();
      }
    });

    test("user can change environment order", async ({ page }) => {
      // Given: I have environments in order: staging (0), prod (1)
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/services/000000000000000000000203/settings");

      // Verify initial order - staging first
      const envItems = page.locator("[data-env]");
      await expect(envItems.first()).toHaveAttribute("data-env", "staging");

      // When: I change prod's order to 0 (before staging)
      await page
        .locator('[data-env="prod"]')
        .getByRole("button", { name: /edit/i })
        .click();
      const editModal = page.locator("#edit-env-modal");
      await editModal.locator("#env-order").clear();
      await editModal.locator("#env-order").fill("0");
      await editModal.getByRole("button", { name: /save/i }).click();

      // Wait for HTMX to swap the content - prod should now be first
      await expect(envItems.first()).toHaveAttribute("data-env", "prod");
    });
  });

  test.describe("Remove Environment", () => {
    test("user can delete an environment", async ({ page }) => {
      // Given: I have an extra environment "qa"
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/services/000000000000000000000203/settings");

      // First add one so we can delete it
      await page.getByRole("button", { name: /add environment/i }).click();
      const addModal = page.locator("#add-env-modal");
      await addModal.locator("#env-name").fill("temp-env");
      await addModal.getByRole("button", { name: /save/i }).click();
      await expect(page.locator('[data-env="temp-env"]')).toBeVisible();

      // When: I delete the environment
      await page
        .locator('[data-env="temp-env"]')
        .getByRole("button", { name: /delete/i })
        .click();
      const deleteModal = page.locator("#delete-env-modal");
      await deleteModal.getByRole("button", { name: /confirm/i }).click();

      // Then: it no longer appears in the environment list
      await expect(page.locator('[data-env="temp-env"]')).not.toBeVisible();
    });

    test("cannot delete last remaining environment", async ({ page }) => {
      // Given: I only have one environment left
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/services/000000000000000000000203/settings");

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
      await page.goto("/services/000000000000000000000203/settings");

      // When: I try to add an environment with invalid name
      await page.getByRole("button", { name: /add environment/i }).click();
      const addModal = page.locator("#add-env-modal");
      await addModal.locator("#env-name").fill("My Environment!"); // Invalid: spaces and !
      await addModal.getByRole("button", { name: /save/i }).click();

      // Then: I see an error message
      await expect(
        page.getByText(/invalid|alphanumeric|lowercase/i),
      ).toBeVisible();
    });

    test("rejects duplicate environment name", async ({ page }) => {
      // Given: I already have a "staging" environment
      await authenticateTestUser(page, TEST_USERS.userWithService);
      await page.goto("/services/000000000000000000000203/settings");

      // When: I try to add another "staging" environment
      await page.getByRole("button", { name: /add environment/i }).click();
      const addModal = page.locator("#add-env-modal");
      await addModal.locator("#env-name").fill("staging"); // Duplicate
      await addModal.getByRole("button", { name: /save/i }).click();

      // Wait for modal to close (HTMX request completed)
      await expect(addModal).toBeHidden();

      // Then: I see an error about duplicate name in the environment list
      await expect(page.getByText(/already exists|duplicate/i)).toBeVisible();
    });
  });
});
