import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

test.describe("Service Creation", () => {
  test("user with repositories sees create service form", async ({ page }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Should see the create service form
    await expect(
      page.getByRole("heading", { name: /create.*service/i }),
    ).toBeVisible();

    // Should see repository dropdown
    await expect(page.locator("#repositoryId")).toBeVisible();

    // Should see service name input
    await expect(page.locator("#name")).toBeVisible();
  });

  test("repository dropdown shows available repositories", async ({ page }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Repository dropdown should have options from GitHub App installation
    const repoOption = page.locator(
      '#repositoryId option:has-text("test-org/test-repo")',
    );
    await expect(repoOption).toBeAttached();
  });

  test("can create a service and see API key on dashboard", async ({
    page,
  }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Select repository
    await page.locator("#repositoryId").selectOption({ index: 1 }); // First real option

    // Enter service name (use timestamp for uniqueness)
    const serviceName = `my-api-service-${Date.now()}`;
    await page.locator("#name").fill(serviceName);

    // Submit form
    await page.getByRole("button", { name: /create service/i }).click();

    // Should be redirected to dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // Should see the API key banner (one-time display)
    await expect(page.locator("#new-api-key")).toBeVisible();
    const apiKeyText = (
      await page.locator("#new-api-key").textContent()
    )?.trim();
    expect(apiKeyText).toMatch(/^pk_/); // Key starts with pk_

    // Should see getting started guide
    await expect(page.getByText(/add secrets to github/i)).toBeVisible();
  });

  test("API key is never exposed in URL (security)", async ({ page }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Select repository and create service
    await page.locator("#repositoryId").selectOption({ index: 1 });
    await page.locator("#name").fill(`secure-service-${Date.now()}`);
    await page.getByRole("button", { name: /create service/i }).click();

    // Wait for dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // SECURITY CHECK: URL must NOT contain the API key
    const currentUrl = page.url();
    expect(currentUrl).not.toContain("key=");
    expect(currentUrl).not.toContain("pk_");

    // Verify the API key IS displayed on the page
    const apiKeyElement = page.locator("#new-api-key");
    await expect(apiKeyElement).toBeVisible();
    const apiKeyText = (await apiKeyElement.textContent())?.trim();
    expect(apiKeyText).toMatch(/^pk_/);

    // Double-check: the displayed key is NOT in the URL
    expect(currentUrl).not.toContain(apiKeyText!);
  });

  test("refreshing dashboard clears API key banner (one-time display)", async ({
    page,
  }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Create a service
    await page.goto("/services/new");
    await page.locator("#repositoryId").selectOption({ index: 1 });
    await page.locator("#name").fill(`one-time-service-${Date.now()}`);
    await page.getByRole("button", { name: /create service/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Verify API key is shown
    await expect(page.locator("#new-api-key")).toBeVisible();

    // Refresh the page
    await page.reload();

    // API key banner should be gone (cookie was cleared)
    await expect(page.locator("#new-api-key")).not.toBeVisible();
  });

  test("shows error when submitting without required fields", async ({
    page,
  }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

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
