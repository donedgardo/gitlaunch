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
});
