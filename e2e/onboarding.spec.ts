import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Onboarding Flow - GitHub App Installation
 *
 * This acceptance test describes the expected user journey:
 * 1. Landing page primary CTA joins the waitlist; Login reaches auth
 * 2. Authenticated user without GitHub App sees onboarding
 * 3. Onboarding prompts user to install GitHub App
 * 4. After installation, user sees repository selection
 * 5. After selecting repos, user goes to dashboard
 * 6. API key is shown when creating a service (not during onboarding)
 */

test.describe("Onboarding - GitHub App Installation", () => {
  test("landing page primary CTA joins the waitlist", async ({ page }) => {
    // Visit the landing page
    await page.goto("/");

    // Verify we're on the landing page
    await expect(
      page.getByRole("heading", { name: /roll it back in one click/i }),
    ).toBeVisible();

    // The primary CTA drives to the waitlist capture, not straight to signup.
    const joinCta = page
      .getByRole("link", { name: /join the waitlist/i })
      .first();
    await expect(joinCta).toBeVisible();
    await expect(joinCta).toHaveAttribute("href", "#start");

    // The bot-protected email-capture form is present and posts to /waitlist
    const form = page.locator("#waitlist-form");
    await expect(form).toHaveAttribute("hx-post", "/waitlist");
    await expect(
      form.getByRole("textbox", { name: /work email/i }),
    ).toBeVisible();

    // Existing users can still reach auth via the Login link, which now leads
    // to the multi-method login page (GitHub, Google, and email/password).
    await expect(page.getByRole("link", { name: /login/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  test("legacy /onboarding entry point redirects to the dashboard", async ({
    page,
  }) => {
    // The old choose-a-CI-provider fork is retired; provider choice now happens
    // per service in the deploy-setup step.
    await authenticateTestUser(page, TEST_USERS.newUser);

    await page.goto("/onboarding");

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("service creation asks only for a name, then guides build reporting", async ({
    page,
  }) => {
    // Reporting-first onboarding: step 1 names the service (no repo URL, no
    // provider), then step 2 helps report builds.
    await authenticateTestUser(page, TEST_USERS.newUser);

    await page.goto("/onboarding/service");

    // Only a name is required — no repository URL field.
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#repoUrl")).toHaveCount(0);

    await page.locator("#name").fill(`svc-${Date.now()}`);
    await page.getByRole("button", { name: /continue/i }).click();

    // Advances to the build-reporting step with provider tabs.
    await expect(page).toHaveURL(/\/onboarding\/report-builds\//);
    await expect(
      page.getByRole("heading", { name: /report your first build/i }),
    ).toBeVisible();
  });

  test("GitHub-connected user is no longer forced into repo selection", async ({
    page,
  }) => {
    // Authenticate as user WITH GitHub App installed
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit the legacy onboarding entry point
    await page.goto("/onboarding");

    // The redirect is unconditional now — even a GitHub-connected user lands on
    // the dashboard rather than a forced repository-selection step.
    await expect(page).toHaveURL(/\/dashboard/);
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
