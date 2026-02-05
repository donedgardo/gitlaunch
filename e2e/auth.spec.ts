import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Authentication Tests
 *
 * Tests for login, logout, and session management.
 */

test.describe("Authentication - Logout", () => {
  test("logout button clears session and redirects to home", async ({
    page,
  }) => {
    // Given: I am logged in
    await authenticateTestUser(page, TEST_USERS.userWithService);
    await page.goto("/dashboard");

    // Verify we're authenticated (should see navigation)
    await expect(page.getByRole("link", { name: /logout/i })).toBeVisible();

    // When: I click logout
    await page.getByRole("link", { name: /logout/i }).click();

    // Then: I should be redirected to home page
    await expect(page).toHaveURL("/");

    // And: Trying to access dashboard should redirect to home (not authenticated)
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/");
  });
});
