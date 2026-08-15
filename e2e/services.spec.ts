import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";
import { createService } from "./helpers/service";

test.describe("Service Creation", () => {
  test("adding a service always enters the onboarding flow", async ({
    page,
  }) => {
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // The dashboard's "new service" link is the old URL; it must land on the
    // same first step a brand-new account sees.
    await page.goto("/services/new");
    await expect(page).toHaveURL(/\/onboarding\/service/);

    await expect(
      page.getByRole("heading", { name: /create a service/i }),
    ).toBeVisible();

    // Name only — no deploy-provider picker, no repo selection. CD is set up
    // after the first build is reported.
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#name")).toHaveAttribute("required", "");
    await expect(page.locator("#provider")).toHaveCount(0);
    await expect(page.locator("#repositoryId")).toHaveCount(0);
  });

  test("an account that already has services gets the same flow", async ({
    page,
  }) => {
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    // Given: a service already exists on this account...
    await createService(page, `first-service-${Date.now()}`);

    // When: I add another one
    await page.goto("/services/new");

    // Then: it's the same first step, not a different form.
    await expect(page).toHaveURL(/\/onboarding\/service/);
    await expect(
      page.getByRole("heading", { name: /create a service/i }),
    ).toBeVisible();
  });

  test("offers to hand the setup to an AI agent, with the key baked in", async ({
    page,
  }) => {
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    const { serviceId, apiKey } = await createService(
      page,
      `agent-service-${Date.now()}`,
    );

    // The agent handoff is the recommended path...
    await expect(
      page.getByRole("heading", { name: /let an ai agent set this up/i }),
    ).toBeVisible();

    const prompt = (await page.locator("#ai_agent_prompt").textContent())!;
    expect(prompt).toContain("/skills/gitlaunch-onboarding/SKILL.md");
    expect(prompt).toContain(serviceId);
    expect(prompt).toContain(apiKey);

    // ...and setting it up by hand is still there underneath.
    await expect(page.getByText(/add secrets to github/i)).toBeVisible();
  });

  test("API key is never exposed in URL (security)", async ({ page }) => {
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    const { apiKey } = await createService(
      page,
      `secure-service-${Date.now()}`,
    );

    const currentUrl = page.url();
    expect(currentUrl).not.toContain("key=");
    expect(currentUrl).not.toContain("sk_");
    expect(currentUrl).not.toContain(apiKey);
  });

  test("a refresh mid-onboarding does not strand you without the key", async ({
    page,
  }) => {
    await authenticateTestUser(page, TEST_USERS.userWithRepos);

    const { apiKey } = await createService(page, `reload-svc-${Date.now()}`);

    await page.reload();

    // Reloading while an agent is working must not lose the one thing you
    // cannot get back from the database.
    await expect(page.locator("#api-key")).toHaveText(apiKey);
  });

  test("unauthenticated user is redirected from create service page", async ({
    page,
  }) => {
    await page.goto("/services/new");

    // Should be redirected off the create page to log in. In real mode that's
    // GitHub's OAuth (github.com); in fake-GitHub dev mode the login completes
    // locally and lands on the dashboard. Either way, not /services/new.
    await expect(page).not.toHaveURL(/\/services\/new/);
    await expect(page).toHaveURL(/github|\/dashboard/);
  });
});
