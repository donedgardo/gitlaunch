import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Build Streaming E2E Tests
 *
 * Tests that new builds appear in real-time via SSE
 */

test.describe("Build Streaming", () => {
  test("new build appears in dashboard via SSE when reported via API", async ({
    page,
    request,
  }) => {
    // Given: I create a new service to get an API key (using isolated user to avoid test conflicts)
    await authenticateTestUser(page, TEST_USERS.userForBuildStream);

    const serviceName = `stream-test-${Date.now()}`;
    await page.goto("/services/new");
    await page.locator("#name").fill(serviceName);
    await page.getByRole("button", { name: /create service/i }).click();

    // Should be on the dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // Extract API key from the dashboard banner
    const apiKey = (await page.locator("#new-api-key").textContent())?.trim();
    expect(apiKey).toMatch(/^sk_/);

    // Get service ID from settings link
    const settingsLink = page.locator(`a[href*="/settings"][title="Settings"]`);
    await expect(settingsLink).toBeVisible();
    const settingsHref = (await settingsLink.getAttribute("href"))!;
    const serviceId = settingsHref.split("/services/")[1].split("/settings")[0];
    expect(serviceId).toBeTruthy();

    // Configure a raw deploy target so builds are dispatchable (Deploy buttons)
    // — a report-only service starts with no CD provider.
    await page.goto(`/onboarding/setup-deploy/${serviceId}`);
    await page.getByRole("button", { name: /raw webhook/i }).click();
    await page.locator("#endpointUrl").fill("https://deploy.example.com/hook");
    await page.getByRole("button", { name: /finish setup/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Report initial build
    const initialBuildId = `initial-${Date.now()}`;
    const initialBuildResponse = await request.post(
      `http://localhost:3051/api/v1/services/${serviceId}/builds`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        data: { buildId: initialBuildId },
      },
    );
    expect(initialBuildResponse.status()).toBe(201);

    // Wait for build to be persisted
    await page.waitForTimeout(500);

    // Navigate to the dashboard (reload to get the initial build)
    await page.goto(`/dashboard/${serviceName}`);

    // Wait for the build table body to be visible
    await expect(page.locator("#build-table-body")).toBeVisible({
      timeout: 10000,
    });

    // When: A new build is reported via API
    const newBuildId = `new-build-${Date.now()}`;
    const response = await request.post(
      `http://localhost:3051/api/v1/services/${serviceId}/builds`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        data: { buildId: newBuildId },
      },
    );

    expect(response.status()).toBe(201);

    // Then: The new build should appear in the dashboard via SSE
    await expect(page.locator(`#build-${newBuildId}`)).toBeVisible({
      timeout: 10000,
    });

    // And: The build should have deploy buttons (one per environment)
    await expect(
      page
        .locator(`#build-${newBuildId}`)
        .getByRole("button", { name: "Deploy" })
        .first(),
    ).toBeVisible();
  });
});
