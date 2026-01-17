import { test, expect } from "@playwright/test";

/**
 * Onboarding Flow - GitHub App Installation
 *
 * This acceptance test describes the expected user journey for new users:
 * 1. User completes GitHub OAuth (simulated via direct callback)
 * 2. New user is redirected to onboarding page (not dashboard)
 * 3. User sees prompt to install GitHub App
 * 4. After GitHub App installation, user sees repository selection
 * 5. User selects repositories to track
 * 6. User is redirected to dashboard
 */

test.describe("Onboarding - GitHub App Installation", () => {
  test("new user is redirected to onboarding after first login", async ({
    page,
  }) => {
    // Visit the landing page
    await page.goto("/");

    // Verify we're on the landing page
    await expect(
      page.getByRole("heading", { name: /deploy with confidence/i }),
    ).toBeVisible();

    // Click the Get Started button
    await page
      .getByRole("link", { name: /get started free/i })
      .first()
      .click();

    // For testing, we simulate the OAuth callback directly
    // In reality, this would go through GitHub OAuth
    // The test expects a redirect to onboarding for new users

    // After OAuth, new user should see the onboarding page
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(
      page.getByRole("heading", { name: /welcome to gitdeploy/i }),
    ).toBeVisible();
  });

  test("onboarding page prompts user to install GitHub App", async ({
    page,
  }) => {
    // Simulate authenticated user on onboarding page
    // TODO: Set up test authentication helper
    await page.goto("/onboarding");

    // Verify onboarding content
    await expect(
      page.getByRole("heading", { name: /connect your repositories/i }),
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

  test("after GitHub App installation, user sees repository selection", async ({
    page,
  }) => {
    // Simulate the GitHub App installation callback
    // GitHub redirects to /github/installation/callback?installation_id=123&setup_action=install
    await page.goto(
      "/github/installation/callback?installation_id=12345&setup_action=install",
    );

    // User should be redirected to repository selection page
    await expect(page).toHaveURL(/\/onboarding\/repositories/);

    // Should see list of available repositories from the installation
    await expect(
      page.getByRole("heading", { name: /select repositories/i }),
    ).toBeVisible();

    // Should see at least one repository to select
    await expect(page.getByRole("checkbox")).toBeVisible();
  });

  test("user can select repositories and complete onboarding", async ({
    page,
  }) => {
    // Start on repository selection page with mocked data
    await page.goto("/onboarding/repositories");

    // Select a repository
    await page.getByRole("checkbox").first().check();

    // Click continue/finish button
    await page
      .getByRole("button", { name: /continue|finish|complete/i })
      .click();

    // Should be redirected to dashboard
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("returning user with GitHub App installed goes directly to dashboard", async ({
    page,
  }) => {
    // TODO: Set up test user with GitHub App already installed
    // Simulate authenticated user who already has GitHub App installed
    await page.goto("/dashboard");

    // Should see the dashboard, not onboarding
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/logout/i)).toBeVisible();
  });
});
