import { test, expect } from "@playwright/test";

/**
 * Landing Hero Board Tests
 *
 * The hero "toy" is a three-column release board that keeps all three columns
 * at every screen size, so its cells get narrow fast — on a phone in portrait,
 * and beside the hero copy on a desktop two-column layout. Whatever a cell
 * shows (a Deploy button, a Live pill, how long it has been live) has to stay
 * inside that cell.
 */

const PHONE_PORTRAIT = { width: 390, height: 844 };

async function overflowingCells(page: import("@playwright/test").Page) {
  return page.$$eval("#board .rcell", (cells) =>
    cells
      .filter((c) => c.scrollWidth - c.clientWidth > 0.5)
      .map((c) => (c.textContent || "").trim().replace(/\s+/g, " ")),
  );
}

test.describe("Landing hero release board", () => {
  test("cells hold their contents on a phone in portrait", async ({ page }) => {
    await page.setViewportSize(PHONE_PORTRAIT);
    await page.goto("/");

    await expect(page.locator("#board")).toBeVisible();
    expect(await overflowingCells(page)).toEqual([]);
  });

  test("a deploying cell holds its contents on a phone in portrait", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE_PORTRAIT);
    await page.goto("/");

    // The board auto-demos one deploy on load; catch it mid-flight.
    await expect(page.locator("#board .cbtn:disabled")).toBeVisible();
    expect(await overflowingCells(page)).toEqual([]);
  });

  test("a freshly deployed cell holds its contents on a phone in portrait", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE_PORTRAIT);
    await page.goto("/");

    // …and settles into a Live pill with how long ago it went live.
    await expect(
      page.locator("#board .when", { hasText: "just now" }),
    ).toBeVisible();
    expect(await overflowingCells(page)).toEqual([]);
  });

  test("cells hold their contents next to the hero copy on desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    await expect(
      page.locator("#board .when", { hasText: "just now" }),
    ).toBeVisible();
    expect(await overflowingCells(page)).toEqual([]);
  });
});
