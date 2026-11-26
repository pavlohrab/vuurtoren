// Shelves on Read (F5): a drag moves a text, Undo puts it back. The demo has the shelves.
import { expect, test } from "@playwright/test";

test("dragging a cover to a shelf moves it, and Undo puts it back (F5)", async ({ page }) => {
  // Tall enough that the drag needs no scrolling: a page scrolled mid-drag loses the drop.
  await page.setViewportSize({ width: 1440, height: 2400 });
  await page.goto("/?demo");
  const news = page.getByRole("region", { name: "News" });
  await expect(news).toBeVisible({ timeout: 20000 });
  // The story shelves load last and push the shelves under them down: wait, or the drag
  // starts on one place and ends on another.
  await expect(page.getByRole("region", { name: /A1/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const opmaat = page.getByRole("region", { name: "De Opmaat" });
  const weer = opmaat.getByRole("link", { name: "Het weer" });
  // By hand, in steps: Playwright's one-call drag sometimes loses an HTML drag in Chromium.
  const from = (await weer.boundingBox())!;
  const to = (await news.locator(".lib-row").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width - 60, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
  // In the toast itself: Radix also announces it, for a moment, in a hidden live region.
  await expect(page.locator(".k-toast").getByText("Moved to “News”")).toBeVisible();
  await expect(news.getByRole("link", { name: "Het weer" })).toBeVisible();
  await expect(opmaat.getByRole("link", { name: "Het weer" })).toHaveCount(0);
  await page.locator(".k-toast").getByRole("button", { name: "Undo" }).click();
  await expect(opmaat.getByRole("link", { name: "Het weer" })).toBeVisible();
  await expect(news.getByRole("link", { name: "Het weer" })).toHaveCount(0);
  await expect(page.locator(".library[data-dragging]")).toHaveCount(0);
});
