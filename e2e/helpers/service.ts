import { Page, expect } from "@playwright/test";

/**
 * Create a service the way a real person does — through the one onboarding
 * flow, whether or not the account already has services. Returns the ids the
 * caller needs to keep going (the API key is only shown here, once).
 */
export async function createService(
  page: Page,
  name: string,
): Promise<{ serviceId: string; apiKey: string }> {
  await page.goto("/onboarding/service");
  await page.locator("#name").fill(name);
  await page.getByRole("button", { name: /continue/i }).click();

  await expect(page).toHaveURL(/\/onboarding\/report-builds\//);

  const serviceId = (await page.locator("#svc-id").textContent())!.trim();
  const apiKey = (await page.locator("#api-key").textContent())!.trim();
  expect(apiKey).toMatch(/^sk_/);

  return { serviceId, apiKey };
}
