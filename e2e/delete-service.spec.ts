import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Delete Service E2E Tests
 */

test.describe("Delete Service", () => {
  test("user can delete a service from settings page", async ({ page }) => {
    // Given: I create a new service (using isolated user to avoid test conflicts)
    await authenticateTestUser(page, TEST_USERS.userForDeleteService);

    const serviceName = `delete-test-${Date.now()}`;
    await page.goto("/services/new");
    await page.locator("#repositoryId").selectOption({ index: 1 });
    await page.locator("#name").fill(serviceName);
    await page.getByRole("button", { name: /create service/i }).click();

    // Should be on the dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // Navigate to settings via the settings gear icon
    const settingsLink = page.locator(`a[href*="/settings"][title="Settings"]`);
    await expect(settingsLink).toBeVisible();
    const settingsHref = await settingsLink.getAttribute("href");
    await page.goto(settingsHref!);

    await expect(page.getByText("Danger Zone")).toBeVisible();

    // When: I click delete and confirm
    await page.getByRole("button", { name: "Delete Service" }).click();

    // Modal should appear
    await expect(page.locator("#delete-service-modal")).toBeVisible();
    await expect(
      page.getByText("This will permanently delete all builds"),
    ).toBeVisible();

    // Confirm deletion
    await page
      .locator("#delete-service-modal")
      .getByRole("button", { name: "Delete Service" })
      .click();

    // Then: Should redirect to dashboard
    await expect(page).toHaveURL("/dashboard", { timeout: 5000 });

    // And: Service should no longer exist in navigation
    await expect(
      page.getByRole("link", { name: serviceName }),
    ).not.toBeVisible();
  });

  test("cancel button closes the delete modal without deleting", async ({
    page,
  }) => {
    // Given: I'm on a service settings page
    await authenticateTestUser(page, TEST_USERS.userWithService);
    await page.goto("/services/000000000000000000000203/settings");

    // When: I click delete but then cancel
    await page.getByRole("button", { name: "Delete Service" }).click();
    await expect(page.locator("#delete-service-modal")).toBeVisible();

    await page
      .locator("#delete-service-modal")
      .getByRole("button", { name: "Cancel" })
      .click();

    // Then: Modal should be hidden
    await expect(page.locator("#delete-service-modal")).toBeHidden();

    // And: Service still exists (we're still on settings page)
    await expect(page).toHaveURL(/\/services\/.*\/settings/);
  });
});
