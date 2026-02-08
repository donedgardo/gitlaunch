import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Service Creation Tests
 *
 * Tests the service creation flow:
 * 1. User without repos is redirected to onboarding
 * 2. User with repos sees the create service form
 * 3. Service creation shows API key and getting started guide
 * 4. API key security (one-time display, not in URL)
 */

test.describe("Service Creation", () => {
  test("user without repositories is redirected to onboarding", async ({
    page,
  }) => {
    // Authenticate as user with GitHub App but no repositories
    await authenticateTestUser(page, TEST_USERS.userWithGitHubAppNoRepos);

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

  test("can create a service and see API key", async ({ page }) => {
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

    // Should be redirected to service created page
    await expect(page).toHaveURL(/\/services\/created/);

    // Should see success message with service name
    await expect(page.getByText(/service created/i)).toBeVisible();
    await expect(page.getByText(serviceName)).toBeVisible();

    // Should see the API key
    await expect(page.locator("#api-key")).toBeVisible();
    const apiKeyText = (await page.locator("#api-key").textContent())?.trim();
    expect(apiKeyText).toMatch(/^pk_/); // Key starts with pk_

    // Should see getting started guide
    await expect(page.getByText(/add secrets to github/i)).toBeVisible();
    // Verify secret names are mentioned (use first() as they appear in workflow code too)
    await expect(
      page.getByText("GITLAUNCH_API_KEY", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("GITLAUNCH_SERVICE_ID", { exact: true }).first(),
    ).toBeVisible();

    // Should see service ID for CI configuration
    await expect(page.locator("#created-service-id")).toBeVisible();
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

    // Wait for navigation to created page
    await expect(page).toHaveURL(/\/services\/created/);

    // SECURITY CHECK: URL must NOT contain the API key or any query parameters
    const currentUrl = page.url();
    expect(currentUrl).not.toContain("key=");
    expect(currentUrl).not.toContain("pk_");
    // Verify the URL ends with /services/created (no query params)
    expect(currentUrl).toMatch(/\/services\/created$/);

    // Verify the API key IS displayed on the page (it's in the cookie-based response)
    const apiKeyElement = page.locator("#api-key");
    await expect(apiKeyElement).toBeVisible();
    const apiKeyText = (await apiKeyElement.textContent())?.trim();
    expect(apiKeyText).toMatch(/^pk_/); // Key starts with pk_

    // Double-check: the displayed key is NOT in the URL
    expect(currentUrl).not.toContain(apiKeyText!);
  });

  test("refreshing created page redirects to dashboard (one-time display)", async ({
    page,
  }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Create a service
    await page.goto("/services/new");
    await page.locator("#repositoryId").selectOption({ index: 1 });
    await page.locator("#name").fill(`one-time-service-${Date.now()}`);
    await page.getByRole("button", { name: /create service/i }).click();
    await expect(page).toHaveURL(/\/services\/created/);

    // Verify API key is shown
    await expect(page.locator("#api-key")).toBeVisible();

    // Refresh the page (simulating user trying to see key again)
    await page.reload();

    // Should be redirected to dashboard (cookie was cleared)
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("continue to dashboard link works", async ({ page }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Create a service
    await page.goto("/services/new");
    await page.locator("#repositoryId").selectOption({ index: 1 });
    await page.locator("#name").fill(`dashboard-link-service-${Date.now()}`);
    await page.getByRole("button", { name: /create service/i }).click();
    await expect(page).toHaveURL(/\/services\/created/);

    // Click continue to dashboard
    await page.locator("#continue-dashboard").click();

    // Should be redirected to dashboard with the new service
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

  test("auto-redirects to dashboard when first build is reported via API", async ({
    page,
    request,
  }) => {
    // Authenticate as user with repositories
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Create a service
    const serviceName = `auto-redirect-service-${Date.now()}`;
    await page.goto("/services/new");
    await page.locator("#repositoryId").selectOption({ index: 1 });
    await page.locator("#name").fill(serviceName);
    await page.getByRole("button", { name: /create service/i }).click();

    // Should be on the setup page
    await expect(page).toHaveURL(/\/services\/created/);

    // Extract API key and service ID from the page
    const apiKey = (await page.locator("#api-key").textContent())?.trim();
    const serviceId = (
      await page.locator("#created-service-id").textContent()
    )?.trim();

    expect(apiKey).toMatch(/^pk_/);
    expect(serviceId).toBeTruthy();

    // Wait for SSE connection to establish
    await page.waitForTimeout(1000);

    // Report a build via the API (use port 3051 which is the E2E test server)
    const buildId = `build-${Date.now()}`;
    const response = await request.post(
      `http://localhost:3051/api/v1/services/${serviceId}/builds`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        data: { buildId },
      },
    );

    expect(response.status()).toBe(201);

    // Page should automatically redirect to dashboard when build is created
    await expect(page).toHaveURL(new RegExp(`/dashboard/${serviceName}`), {
      timeout: 10000,
    });
  });
});
