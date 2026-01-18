import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Onboarding Flow - GitHub App Installation
 *
 * This acceptance test describes the expected user journey:
 * 1. Landing page has "Get Started" button that links to auth
 * 2. Authenticated user without GitHub App sees onboarding
 * 3. Onboarding prompts user to install GitHub App
 * 4. After installation, user sees repository selection
 * 5. User with GitHub App installed goes directly to dashboard
 */

test.describe("Onboarding - GitHub App Installation", () => {
  test("landing page has Get Started button linking to auth", async ({
    page,
  }) => {
    // Visit the landing page
    await page.goto("/");

    // Verify we're on the landing page
    await expect(
      page.getByRole("heading", { name: /deploy with confidence/i }),
    ).toBeVisible();

    // Verify Get Started button exists and links to auth
    const getStartedLink = page
      .getByRole("link", { name: /get started free/i })
      .first();
    await expect(getStartedLink).toBeVisible();
    await expect(getStartedLink).toHaveAttribute("href", "/auth/github");
  });

  test("user without GitHub App sees onboarding page", async ({ page }) => {
    // Authenticate as user without GitHub App
    await authenticateTestUser(page, TEST_USERS.newUser);

    // Visit onboarding page
    await page.goto("/onboarding");

    // Should see the onboarding page
    await expect(
      page.getByRole("heading", { name: /welcome to gitdeploy/i }),
    ).toBeVisible();
  });

  test("onboarding page prompts user to install GitHub App", async ({
    page,
  }) => {
    // Authenticate as user without GitHub App
    await authenticateTestUser(page, TEST_USERS.newUser);

    // Visit onboarding page
    await page.goto("/onboarding");

    // Verify onboarding content
    await expect(
      page.getByRole("heading", { name: /welcome to gitdeploy/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/install the gitdeploy github app/i),
    ).toBeVisible();

    // Verify install button exists and links to GitHub
    const installButton = page.getByRole("link", {
      name: /install github app/i,
    });
    await expect(installButton).toBeVisible();
    await expect(installButton).toHaveAttribute(
      "href",
      /github\.com\/apps\/.*\/installations\/new/,
    );
  });

  test("user with GitHub App is redirected to repository selection", async ({
    page,
  }) => {
    // Authenticate as user WITH GitHub App installed
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit onboarding page
    await page.goto("/onboarding");

    // Should be redirected to repository selection (has GitHub App)
    await expect(page).toHaveURL(/\/onboarding\/repositories/);

    // Should see repository selection page
    await expect(
      page.getByRole("heading", { name: /select repositories/i }),
    ).toBeVisible();
  });

  test("repository selection page has navigation options", async ({ page }) => {
    // Authenticate as user WITH GitHub App installed
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit repository selection page
    await page.goto("/onboarding/repositories");

    // Should see the selection page
    await expect(
      page.getByRole("heading", { name: /select repositories/i }),
    ).toBeVisible();

    // Should have a continue button or skip link
    const continueButton = page.getByRole("button", { name: /continue/i });
    const skipLink = page.getByRole("link", { name: /skip/i });

    // At least one of these should be visible
    const hasNavigation =
      (await continueButton.isVisible()) || (await skipLink.isVisible());
    expect(hasNavigation).toBe(true);
  });

  test("skipping repository selection goes to dashboard", async ({ page }) => {
    // Authenticate as user WITH GitHub App installed
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit repository selection page
    await page.goto("/onboarding/repositories");

    // Click skip link
    await page.getByRole("link", { name: /skip/i }).click();

    // Should be redirected to dashboard
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("clicking Continue on repository selection shows API key", async ({
    page,
  }) => {
    // Authenticate as user WITH GitHub App installed
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit repository selection page
    await page.goto("/onboarding/repositories");

    // Should see the selection page
    await expect(
      page.getByRole("heading", { name: /select repositories/i }),
    ).toBeVisible();

    // Click the Continue button
    await page.getByRole("button", { name: /continue/i }).click();

    // Should be redirected to onboarding complete page
    await expect(page).toHaveURL(/\/onboarding\/complete/);

    // Should see the API key heading and the key itself
    await expect(
      page.getByRole("heading", { name: /your api key/i }),
    ).toBeVisible();
    await expect(page.locator("#api-key")).toBeVisible();

    // Should have a link to dashboard
    await expect(
      page.getByRole("link", { name: /continue to dashboard/i }),
    ).toBeVisible();
  });

  test("onboarding complete page leads to dashboard", async ({ page }) => {
    // Authenticate as user WITH GitHub App installed
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit repository selection page and complete onboarding
    await page.goto("/onboarding/repositories");
    await page.getByRole("button", { name: /continue/i }).click();

    // Should be on complete page
    await expect(page).toHaveURL(/\/onboarding\/complete/);

    // Click continue to dashboard
    await page.getByRole("link", { name: /continue to dashboard/i }).click();

    // Should be redirected to dashboard
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("API key is never exposed in URL (security)", async ({ page }) => {
    // Authenticate as user WITH GitHub App installed
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit repository selection page
    await page.goto("/onboarding/repositories");

    // Click Continue to complete onboarding
    await page.getByRole("button", { name: /continue/i }).click();

    // Wait for navigation to complete page
    await expect(page).toHaveURL(/\/onboarding\/complete/);

    // SECURITY CHECK: URL must NOT contain the API key or any query parameters
    const currentUrl = page.url();
    expect(currentUrl).not.toContain("key=");
    expect(currentUrl).not.toContain("pk_");
    expect(currentUrl).toBe(
      `${process.env.TEST_BASE_URL || "http://localhost:3050"}/onboarding/complete`,
    );

    // Verify the API key IS displayed on the page (it's in the cookie-based response)
    const apiKeyElement = page.locator("#api-key");
    await expect(apiKeyElement).toBeVisible();
    const apiKeyText = await apiKeyElement.textContent();
    expect(apiKeyText).toMatch(/^pk_/); // Key starts with pk_

    // Double-check: the displayed key is NOT in the URL
    expect(currentUrl).not.toContain(apiKeyText);
  });

  test("refreshing complete page redirects to dashboard (one-time display)", async ({
    page,
  }) => {
    // Authenticate as user WITH GitHub App installed
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Complete onboarding flow
    await page.goto("/onboarding/repositories");
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/complete/);

    // Verify API key is shown
    await expect(page.locator("#api-key")).toBeVisible();

    // Refresh the page (simulating user trying to see key again)
    await page.reload();

    // Should be redirected to dashboard (cookie was cleared)
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
