import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

test.describe("Service Creation", () => {
  test("create service form asks only for a name (report-only)", async ({
    page,
  }) => {
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    await page.goto("/services/new");

    // Should see the create service form
    await expect(
      page.getByRole("heading", { name: /create.*service/i }),
    ).toBeVisible();

    // Name is required; there's an optional repo URL — no deploy-provider
    // picker (CD is chosen later in deploy setup).
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#repoUrl")).toBeVisible();
    await expect(page.locator("#provider")).toHaveCount(0);
    await expect(page.locator("#repositoryId")).toHaveCount(0);
  });

  test("can create a service and see API key on dashboard", async ({
    page,
  }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Enter service name (use timestamp for uniqueness) — no repo selection
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
    expect(apiKeyText).toMatch(/^sk_/); // Service keys are secret keys

    // Should see a build-reporting guide (defaults to GitHub for report-only)
    await expect(page.getByText(/add secrets to github/i)).toBeVisible();
  });

  test("API key is never exposed in URL (security)", async ({ page }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    // Create a service (name only)
    await page.locator("#name").fill(`secure-service-${Date.now()}`);
    await page.getByRole("button", { name: /create service/i }).click();

    // Wait for dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // SECURITY CHECK: URL must NOT contain the API key
    const currentUrl = page.url();
    expect(currentUrl).not.toContain("key=");
    expect(currentUrl).not.toContain("sk_");

    // Verify the API key IS displayed on the page
    const apiKeyElement = page.locator("#new-api-key");
    await expect(apiKeyElement).toBeVisible();
    const apiKeyText = (await apiKeyElement.textContent())?.trim();
    expect(apiKeyText).toMatch(/^sk_/);

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

  test("requires a name (deploy provider is chosen later)", async ({
    page,
  }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Visit create service page
    await page.goto("/services/new");

    const submitButton = page.getByRole("button", { name: /create service/i });
    await expect(submitButton).toBeVisible();

    // Service name is required at the form level.
    await expect(page.locator("#name")).toHaveAttribute("required", "");

    // No CI/CD provider picker here — deployment is set up after reporting a
    // build, so creation never assumes a deploy provider.
    await expect(page.locator("#provider")).toHaveCount(0);
  });

  test("unauthenticated user is redirected from create service page", async ({
    page,
  }) => {
    // Visit create service page without authentication
    await page.goto("/services/new");

    // Should be redirected off the create page to log in. In real mode that's
    // GitHub's OAuth (github.com); in fake-GitHub dev mode the login completes
    // locally and lands on the dashboard. Either way, not /services/new.
    await expect(page).not.toHaveURL(/\/services\/new/);
    await expect(page).toHaveURL(/github|\/dashboard/);
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
