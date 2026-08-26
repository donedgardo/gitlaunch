import { test, expect } from "@playwright/test";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

/**
 * Mobile layout guarantees.
 *
 * The bug these lock down: the account links in the nav were a ~538px row
 * that could neither wrap nor shrink. A phone's layout viewport expanded to
 * fit it (~895px), so every page rendered zoomed out to roughly 40% and the
 * whole app was unreadable — on pages that had nothing to do with the nav.
 *
 * The assertion is deliberately about outcome rather than markup: whatever
 * the nav is built from, a phone must lay the page out at the phone's width.
 */
// iPhone SE dimensions — the narrow end of what real users carry. Set
// explicitly rather than via a `devices` preset, because those presets pull
// in WebKit and this project runs its e2e suite on Chromium.
test.use({
  viewport: { width: 375, height: 667 },
  isMobile: true,
  hasTouch: true,
});

const PAGES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "service dashboard", path: "/dashboard/frontend" },
  { name: "team settings", path: "/settings/team" },
  { name: "api keys", path: "/settings/api-keys" },
];

test.describe("mobile layout", () => {
  test.beforeEach(async ({ page }) => {
    await authenticateTestUser(page, TEST_USERS.userWithMultipleServices);
  });

  for (const { name, path } of PAGES) {
    test(`${name} lays out at the phone's width`, async ({ page }) => {
      await page.goto(path);
      await page.waitForSelector("#main-navigation");

      const { innerWidth, scrollWidth } = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      // The viewport was not expanded to fit oversized content...
      expect(innerWidth).toBeLessThanOrEqual(420);
      // ...and nothing overflows it sideways.
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
    });
  }

  test("account links are behind a menu button, not spilling across the bar", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    const links = page.locator("#gl-nav-links");
    const toggle = page.locator("[data-gl-nav-toggle]");

    // Collapsed by default on a phone.
    await expect(links).toBeHidden();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // The button is a real touch target.
    const box = await toggle.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // Opening it reveals the account links.
    await toggle.click();
    await expect(links).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();

    // And it closes again.
    await toggle.click();
    await expect(links).toBeHidden();
  });

  test("the release board reads as cards, with each environment labelled", async ({
    page,
  }) => {
    await page.goto("/dashboard/frontend");
    await page.waitForSelector(".gl-board");

    // Every environment cell names its environment, since the phone layout
    // drops the column headers the desktop table relies on.
    const cells = page.locator(".gl-env-cell");
    await expect(cells.first()).toHaveAttribute("data-env", /.+/);

    // Cells stack instead of sitting side by side in a scrolling table.
    const first = await cells.nth(0).boundingBox();
    const second = await cells.nth(1).boundingBox();
    expect(second!.y).toBeGreaterThan(first!.y);

    // The board fits the screen — no sideways scrolling to reach an env.
    const board = await page.locator(".gl-board").boundingBox();
    expect(board!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });

  test("deploy stays reachable and tappable on a phone", async ({ page }) => {
    await page.goto("/dashboard/frontend");
    const deploy = page.getByRole("button", { name: "Deploy" }).first();
    await expect(deploy).toBeVisible();

    const box = await deploy.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
    // Fully within the viewport, not clipped off the side.
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
  });
});

test.describe("desktop layout is unchanged", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
  });

  test("nav is a single row with the account links inline", async ({
    page,
  }) => {
    await authenticateTestUser(page, TEST_USERS.userWithMultipleServices);
    await page.goto("/dashboard");

    // No menu button, links always visible.
    await expect(page.locator("[data-gl-nav-toggle]")).toBeHidden();
    await expect(page.locator("#gl-nav-links")).toBeVisible();

    // Brand and account links share one row.
    const brand = await page.locator(".gl-brand").boundingBox();
    const links = await page.locator("#gl-nav-links").boundingBox();
    expect(Math.abs(brand!.y - links!.y)).toBeLessThan(30);
  });

  test("the board keeps its table shape on a wide screen", async ({ page }) => {
    await authenticateTestUser(page, TEST_USERS.userWithMultipleServices);
    await page.goto("/dashboard/frontend");
    await page.waitForSelector(".gl-board");

    await expect(page.locator(".gl-board thead")).toBeVisible();

    // Environment cells sit side by side, as columns.
    const cells = page.locator(".gl-env-cell");
    const first = await cells.nth(0).boundingBox();
    const second = await cells.nth(1).boundingBox();
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(5);
    expect(second!.x).toBeGreaterThan(first!.x);
  });
});
