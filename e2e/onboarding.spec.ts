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
 * 5. After selecting repos, user goes to dashboard
 * 6. API key is shown when creating a service (not during onboarding)
 */

test.describe("Onboarding - GitHub App Installation", () => {
  test("landing page has Get Started button linking to auth", async ({
    page,
  }) => {
    // Visit the landing page
    await page.goto("/");

    // Verify we're on the landing page
    await expect(
      page.getByRole("heading", { name: /roll it back in one click/i }),
    ).toBeVisible();

    // Verify the primary "Start free" CTA exists and links to auth
    const getStartedLink = page
      .getByRole("link", { name: /start free/i })
      .first();
    await expect(getStartedLink).toBeVisible();
    await expect(getStartedLink).toHaveAttribute("href", "/auth/github");
  });

  test("user without a provider sees the provider choice", async ({ page }) => {
    // Authenticate as user without any CI provider connected
    await authenticateTestUser(page, TEST_USERS.newUser);

    // Visit onboarding page
    await page.goto("/onboarding");

    // Should see the provider-choice page (not a forced GitHub App install)
    await expect(
      page.getByRole("heading", { name: /how do you deploy/i }),
    ).toBeVisible();
  });

  test("onboarding offers both GitHub App and Jenkins", async ({ page }) => {
    // Authenticate as user without any CI provider connected
    await authenticateTestUser(page, TEST_USERS.newUser);

    // Visit onboarding page
    await page.goto("/onboarding");

    // GitHub App install is one option...
    const installButton = page.getByRole("link", {
      name: /install github app/i,
    });
    await expect(installButton).toBeVisible();
    await expect(installButton).toHaveAttribute("href", /.+/);

    // ...and Jenkins is the other — no GitHub App required.
    await expect(
      page.getByRole("link", { name: /connect jenkins/i }),
    ).toBeVisible();
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

  test("clicking Continue on repository selection goes to dashboard", async ({
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

    // Should be redirected to dashboard (API key shown when creating service)
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("Onboarding - Plan Enforcement", () => {
  test("free plan user sees plan limits in UI", async ({ page }) => {
    // Authenticate as free plan user WITH GitHub App
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit repository selection page
    await page.goto("/onboarding/repositories");

    // Should see plan limits notice
    const planLimits = page.locator("#plan-limits");
    await expect(planLimits).toBeVisible();

    // Should see "free" plan and "1" repository limit
    await expect(planLimits).toContainText("free");
    await expect(page.locator("#max-repos")).toHaveText("1");

    // Should see "public only" notice
    await expect(page.locator("#public-only-notice")).toBeVisible();
    await expect(page.locator("#public-only-notice")).toContainText(
      "Public repos only",
    );
  });

  test("paid plan user sees higher limits without public-only restriction", async ({
    page,
  }) => {
    // Authenticate as paid plan user
    await authenticateTestUser(page, TEST_USERS.paidUserWithGitHubApp);

    // Visit repository selection page
    await page.goto("/onboarding/repositories");

    // Should see plan limits notice
    const planLimits = page.locator("#plan-limits");
    await expect(planLimits).toBeVisible();

    // Should see "paid" plan and "5" repository limit
    await expect(planLimits).toContainText("paid");
    await expect(page.locator("#max-repos")).toHaveText("5");

    // Should NOT see "public only" notice
    await expect(page.locator("#public-only-notice")).not.toBeVisible();
  });

  test("free plan user gets error when selecting more than 1 repo", async ({
    page,
  }) => {
    // Authenticate as free plan user WITH GitHub App
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit repository selection page
    await page.goto("/onboarding/repositories");

    // Should see mock repositories
    await expect(page.getByText("test-org/public-repo-1")).toBeVisible();
    await expect(page.getByText("test-org/public-repo-2")).toBeVisible();

    // Select 2 public repos (exceeds free plan limit of 1)
    await page
      .locator("label", { hasText: "test-org/public-repo-1" })
      .locator('input[type="checkbox"]')
      .check();
    await page
      .locator("label", { hasText: "test-org/public-repo-2" })
      .locator('input[type="checkbox"]')
      .check();

    // Submit form
    await page.getByRole("button", { name: /continue/i }).click();

    // Should see error message
    await expect(page.locator("#plan-error")).toBeVisible();
    await expect(page.locator("#plan-error")).toContainText(
      "Repository limit reached",
    );

    // Should still be on the repo selection page
    await expect(page).toHaveURL(/\/onboarding\/repositories/);
  });

  test("free plan user gets error when selecting private repo", async ({
    page,
  }) => {
    // Authenticate as free plan user WITH GitHub App
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit repository selection page
    await page.goto("/onboarding/repositories");

    // Should see private repo with "Private" badge
    const privateRepoLabel = page.locator("label", {
      hasText: "test-org/private-repo",
    });
    await expect(privateRepoLabel).toBeVisible();
    await expect(privateRepoLabel).toContainText("Private");

    // Select the private repo
    await privateRepoLabel.locator('input[type="checkbox"]').check();

    // Submit form
    await page.getByRole("button", { name: /continue/i }).click();

    // Should see error message about private repos
    await expect(page.locator("#plan-error")).toBeVisible();
    await expect(page.locator("#plan-error")).toContainText(
      "Private repositories require a paid plan",
    );

    // Should still be on the repo selection page
    await expect(page).toHaveURL(/\/onboarding\/repositories/);
  });

  test("paid plan user can select multiple repos including private", async ({
    page,
  }) => {
    // Authenticate as paid plan user
    await authenticateTestUser(page, TEST_USERS.paidUserWithGitHubApp);

    // Visit repository selection page
    await page.goto("/onboarding/repositories");

    // Select multiple repos including private
    await page
      .locator("label", { hasText: "test-org/public-repo-1" })
      .locator('input[type="checkbox"]')
      .check();
    await page
      .locator("label", { hasText: "test-org/public-repo-2" })
      .locator('input[type="checkbox"]')
      .check();
    await page
      .locator("label", { hasText: "test-org/private-repo" })
      .locator('input[type="checkbox"]')
      .check();

    // Submit form
    await page.getByRole("button", { name: /continue/i }).click();

    // Should be redirected to dashboard (success)
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("free plan user can select one public repo successfully", async ({
    page,
  }) => {
    // Authenticate as free plan user WITH GitHub App
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit repository selection page
    await page.goto("/onboarding/repositories");

    // Select 1 public repo (within free plan limit)
    await page
      .locator("label", { hasText: "test-org/public-repo-1" })
      .locator('input[type="checkbox"]')
      .check();

    // Submit form
    await page.getByRole("button", { name: /continue/i }).click();

    // Should be redirected to dashboard (success)
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
