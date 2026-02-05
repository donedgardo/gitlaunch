import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Workflow Dropdown E2E Tests
 *
 * BUG: Workflow dropdown always empty when setting up a service
 *
 * WHY THIS MATTERS:
 * ─────────────────
 * When setting up a service, users need to select which GitHub Actions workflow
 * to use for deployments. The dropdown should populate with workflows from the
 * repository. If it's always empty, users can't properly configure their service.
 *
 * ROOT CAUSE INVESTIGATION:
 * ─────────────────────────
 * 1. The dropdown is in `src/templates/partials/deploymentSetupGuide.hbs`
 * 2. It loads via HTMX from `/services/:serviceId/workflows`
 * 3. That route calls `githubAppService.listRepositoryWorkflows()`
 * 4. Which calls GitHub's `/repos/{owner}/{repo}/actions/workflows` API
 *
 * EXPECTED BEHAVIOR:
 * ──────────────────
 * When a user creates a service and sees the deployment setup guide,
 * the workflow dropdown should show all workflows from the repository.
 */

test.describe("Workflow Dropdown", () => {
  test("workflow dropdown populates with repository workflows when setting up a service", async ({
    page,
  }) => {
    // Given: I am logged in as a user with a service
    await authenticateTestUser(page, TEST_USERS.userWithService);

    // When: I go to the service page that shows the deployment setup guide
    // The userWithService has service ID 000000000000000000000203
    // This service doesn't have builds yet, so it should show the setup guide
    await page.goto("/dashboard/env-test-service");

    // The deployment setup guide is shown when a service has no builds
    // Let's navigate to a route that triggers the workflow dropdown
    // We can access it directly via the workflows endpoint for the service
    await page.goto("/services/000000000000000000000203/settings");

    // First, let's test the HTMX endpoint directly by checking if we can
    // access the workflows endpoint
    const response = await page.request.get(
      "http://localhost:3051/services/000000000000000000000203/workflows",
    );

    // The endpoint should return 200 OK
    expect(response.status()).toBe(200);

    // The response should contain workflow options (not empty or error)
    const html = await response.text();

    // Then: The dropdown should contain workflow options from the repository
    // NOT "No workflows found" or "Failed to load workflows"
    expect(html).not.toContain("No workflows found");
    expect(html).not.toContain("Failed to load workflows");
    expect(html).not.toContain("Loading workflows...");

    // It should contain actual workflow options
    // The mock should return workflows like "CI" and "Deploy"
    expect(html).toContain("<option");
    expect(html).toMatch(/value=".*\.yml"/); // Should have .yml files
  });

  test("workflow dropdown shows workflow names from GitHub", async ({
    page,
  }) => {
    // Given: I am logged in with a service
    await authenticateTestUser(page, TEST_USERS.userWithService);

    // When: I fetch the workflows endpoint
    const response = await page.request.get(
      "http://localhost:3051/services/000000000000000000000203/workflows",
    );

    // Then: It should contain workflow names from GitHub
    expect(response.ok()).toBe(true);
    const html = await response.text();

    // Should contain the mocked workflow names
    expect(html).toContain("CI");
    expect(html).toContain("Deploy");
  });
});
