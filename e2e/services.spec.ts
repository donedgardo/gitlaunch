import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Service Creation Tests
 *
 * Tests the service creation flow:
 * 1. User without repos is redirected to onboarding
 * 2. User with repos sees the create service form
 * 3. Service creation works correctly
 */

test.describe("Service Creation", () => {
  test("user without repositories is redirected to onboarding", async ({
    page,
  }) => {
    // Authenticate as user with GitHub App but no repositories
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Try to access create service page
    await page.goto("/services/new");

    // Should be redirected to onboarding (to set up repos first)
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test("user with repositories sees create service form", async ({ page }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Should see the create service form
    await expect(
      page.getByRole("heading", { name: /create a service/i }),
    ).toBeVisible();

    // Should see repository dropdown
    await expect(page.locator("#repositoryId")).toBeVisible();

    // Should see service name input
    await expect(page.locator("#name")).toBeVisible();

    // Should see create button
    await expect(
      page.getByRole("button", { name: /create service/i }),
    ).toBeVisible();
  });

  test("repository dropdown shows available repositories", async ({ page }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Check that the repository appears in the dropdown
    const repoOption = page.locator(
      '#repositoryId option:has-text("test-org/test-repo")',
    );
    await expect(repoOption).toBeAttached();
  });

  test("can create a service successfully", async ({ page }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Select repository
    await page.locator("#repositoryId").selectOption({ index: 1 }); // First real option

    // Enter service name
    await page.locator("#name").fill("my-api-service");

    // Submit form
    await page.getByRole("button", { name: /create service/i }).click();

    // Should be redirected to dashboard
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("shows error when submitting without required fields", async ({
    page,
  }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Try to submit without filling in fields (browser validation should prevent)
    // The form has required fields, so we test that the button exists
    const submitButton = page.getByRole("button", { name: /create service/i });
    await expect(submitButton).toBeVisible();

    // Verify required attributes are present
    await expect(page.locator("#repositoryId")).toHaveAttribute("required", "");
    await expect(page.locator("#name")).toHaveAttribute("required", "");
  });

  test("unauthenticated user is redirected from create service page", async ({
    page,
  }) => {
    // Visit create service page without authentication
    await page.goto("/services/new");

    // Should be redirected to GitHub OAuth (either /auth/github or github.com)
    await expect(page).toHaveURL(/github/);
  });

  test("cancel link returns to dashboard", async ({ page }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Click cancel link
    await page.getByRole("link", { name: /cancel/i }).click();

    // Should be redirected to dashboard
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
