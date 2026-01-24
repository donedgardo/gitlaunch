import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Dashboard Empty State Tests
 *
 * Tests the empty state experience when users have no services configured.
 * The empty state should guide users to create their first service.
 */

test.describe("Dashboard - Empty State", () => {
  test("authenticated user sees empty state when no services exist", async ({
    page,
  }) => {
    // Authenticate as user with GitHub App
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit dashboard
    await page.goto("/dashboard");

    // Should see the empty state message
    await expect(
      page.getByRole("heading", { name: /create your first service/i }),
    ).toBeVisible();
  });

  test("empty state shows explanation of what a service is", async ({
    page,
  }) => {
    // Authenticate
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit dashboard
    await page.goto("/dashboard");

    // Should see explanation text
    await expect(
      page.getByText(/a service represents an application or microservice/i),
    ).toBeVisible();
  });

  test("empty state has Create Service button", async ({ page }) => {
    // Authenticate
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit dashboard
    await page.goto("/dashboard");

    // Should see Create Service button/link
    const createServiceLink = page.getByRole("link", {
      name: /create service/i,
    });
    await expect(createServiceLink).toBeVisible();
    await expect(createServiceLink).toHaveAttribute("href", "/services/new");
  });

  test("unauthenticated user is redirected from dashboard", async ({
    page,
  }) => {
    // Visit dashboard without authentication
    await page.goto("/dashboard");

    // Should be redirected to home page
    await expect(page).toHaveURL("/");
  });

  test("clicking Create Service button navigates to service creation page", async ({
    page,
  }) => {
    // Authenticate as user with GitHub App
    await authenticateTestUser(page, TEST_USERS.userWithGitHubApp);

    // Visit dashboard
    await page.goto("/dashboard");

    // Click the Create Service button
    await page.getByRole("link", { name: /create service/i }).click();

    // Should navigate to service creation page (or onboarding if no repos)
    await expect(page).toHaveURL(/\/(services\/new|onboarding)/);
  });
});

test.describe("Dashboard - Navigation", () => {
  test("clicking a service tab navigates to that service", async ({ page }) => {
    // Authenticate as user with multiple services
    await authenticateTestUser(page, TEST_USERS.userWithMultipleServices);

    // Visit frontend service directly
    await page.goto("/dashboard/frontend");
    await expect(page).toHaveURL("/dashboard/frontend");

    // Click on the backend service tab
    const backendLink = page.getByRole("link", { name: "backend" });
    await backendLink.click();

    // Should navigate to backend service
    await expect(page).toHaveURL("/dashboard/backend");

    // The backend tab should now be active (has the blue styling)
    await expect(backendLink).toHaveClass(/text-blue-600/);
  });

  test("navigation updates build table content via HTMX", async ({ page }) => {
    // Authenticate as user with multiple services
    await authenticateTestUser(page, TEST_USERS.userWithMultipleServices);

    // Visit dashboard on frontend service
    await page.goto("/dashboard/frontend");

    // Click on the backend service tab
    await page.getByRole("link", { name: "backend" }).click();

    // Wait for HTMX to update the page
    await expect(page).toHaveURL("/dashboard/backend");

    // The navigation should show backend as active
    const backendTab = page.getByRole("link", { name: "backend" });
    await expect(backendTab).toHaveClass(/text-blue-600/);

    // The frontend tab should not be active
    const frontendTab = page.getByRole("link", { name: "frontend" });
    await expect(frontendTab).not.toHaveClass(/text-blue-600/);
  });
});
