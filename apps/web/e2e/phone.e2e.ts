/**
 * Phone widths (360 and 412 px, touch): nothing sticks out on the right of Read, the reader bar
 * or the word sheet, and the safe areas the Android app reports keep the top bar under the
 * status bar and the tab bar above the gesture handle. `PHONE_SHOTS=<dir>` also saves a
 * screenshot of each screen there.
 */
import { type Page, expect, test } from "@playwright/test";
import { fakeAnki } from "./fakeAnki.js";
import { fakeNlp } from "./fakeNlp.js";

const SIZES = [
  { width: 360, height: 800 },
  { width: 412, height: 915 },
] as const;
const SHOTS = process.env["PHONE_SHOTS"];

/** Elements (by selector) whose right edge is past the viewport, with their widths. */
async function overflowing(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? "";
        out.push(`${el.tagName.toLowerCase()}.${el.className} "${name}" ${r.left}–${r.right}`);
      }
    }
    return out;
  }, selector);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

for (const size of SIZES) {
  test.describe(`phone ${size.width}px`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

    test("Read, the reader bar and the word sheet fit the screen", async ({ page }) => {
      await page.goto("/?demo");
      await expect(page.getByText("Demo data")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Read" })).toBeVisible();
      // The level's separator has room on both sides ("A1 · Start here").
      await expect(page.locator(".lib-story-sep").first()).toBeVisible();
      expect(await overflowing(page, ".topbar *, .page-header *")).toEqual([]);
      await shot(page, `read-${size.width}`);

      await page.getByRole("link", { name: "Een dag in Utrecht" }).first().click();
      await expect(page).toHaveURL(/\/read\//);
      await expect(page.locator(".k-reader .k-tok").first()).toBeVisible();
      expect(await overflowing(page, ".topbar button, .topbar [role=tab], .topbar span")).toEqual(
        [],
      );
      await shot(page, `reader-${size.width}`);

      await page.locator(".k-reader .k-tok", { hasText: /^bel$/ }).first().click();
      const sheet = page.locator(".inspector-panel");
      await expect(sheet).toContainText("bel");
      await page.waitForTimeout(400);
      expect(await overflowing(page, ".inspector-panel, .inspector-panel button")).toEqual([]);
      await shot(page, `word-${size.width}`);

      // A swipe to the left turns to the next page.
      await page.keyboard.press("Escape");
      const count = page.locator(".reader-pager-count [aria-hidden]");
      const before = await count.textContent();
      await page.locator(".reader-turn").evaluate((el) => {
        const at = (type: string, x: number, t: number) =>
          new PointerEvent(type, {
            pointerType: "touch",
            isPrimary: true,
            pointerId: 7,
            clientX: x,
            clientY: 300,
            bubbles: true,
            timeStamp: t,
          } as PointerEventInit);
        el.dispatchEvent(at("pointerdown", 300, 0));
        el.dispatchEvent(at("pointerup", 80, 100));
      });
      await expect(count).not.toHaveText(before ?? "");
    });

    test("a new learner: the welcome, the story in the reader, the word sheet", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await fakeNlp(page);
      await fakeAnki(page);
      await page.goto("/");
      // The first start sets up the database in the browser first: allow for it.
      await expect(page.getByRole("heading", { name: "Welcome to Vuurtoren" })).toBeVisible({
        timeout: 40_000,
      });
      await page.getByRole("radio", { name: /^No/ }).check();
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "The most common words" })).toBeVisible();
      expect(await overflowing(page, ".ob-card *")).toEqual([]);
      await shot(page, `welcome-words-${size.width}`);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Start reading" }).click();
      await expect(page).toHaveURL(/[/]read[/]/);
      await expect(page.locator(".k-reader .k-tok").first()).toBeVisible();
      expect(await overflowing(page, ".topbar button, .topbar [role=tab], .topbar span")).toEqual(
        [],
      );
      await shot(page, `reader-native-${size.width}`);

      // The mode is one button on a phone, with the four modes in a menu.
      await page.getByRole("button", { name: /^Reading mode: Read/ }).click();
      await page.getByRole("radio", { name: /^Gloss/ }).click();
      await expect(page.getByRole("button", { name: /^Reading mode: Gloss/ })).toBeVisible();

      // The word sheet opens at a peek, the handle shows everything, a tap outside closes it.
      await page.locator(".k-reader .k-tok").nth(1).click();
      const sheet = page.locator(".inspector-panel");
      await expect(sheet).toHaveAttribute("data-sheet", "peek");
      await page.waitForTimeout(400);
      expect(await overflowing(page, ".inspector-panel, .inspector-panel button")).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        size.width,
      );
      await shot(page, `sheet-peek-${size.width}`);
      await page.getByRole("button", { name: "Show all of the word panel" }).click();
      await expect(sheet).toHaveAttribute("data-sheet", "full");
      await page.waitForTimeout(400);
      await shot(page, `sheet-full-${size.width}`);
      await page.getByRole("button", { name: "Show less of the word panel" }).click();
      await page.locator(".topbar").click({ position: { x: 4, y: 4 } });
      await expect(page.locator(".shell")).toHaveAttribute("data-inspector", "closed");
    });

    test("safe areas from the app keep the bars clear of the system bars", async ({ page }) => {
      await page.addInitScript(() => {
        (window as { VuurtorenInsets?: { get(): string } }).VuurtorenInsets = {
          get: () => '{"top":32,"right":0,"bottom":34,"left":0}',
        };
      });
      await page.goto("/?demo");
      await expect(page.getByText("Demo data")).toBeVisible();
      const notices = await page.locator(".main").evaluate((el) => {
        const first = el.firstElementChild as HTMLElement;
        return first.getBoundingClientRect().top;
      });
      expect(notices).toBeGreaterThanOrEqual(32);
      // Three thumb-sized tabs, all of them 8px or more above the gesture handle (34px here).
      const nav = page.getByRole("navigation", { name: "Main" });
      const tabs = nav.locator(".nav-link:visible, .nav-more");
      await expect(tabs).toHaveCount(3);
      for (const box of await tabs.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect),
      )) {
        expect(box.height).toBeGreaterThanOrEqual(56);
        expect(box.bottom).toBeLessThanOrEqual(size.height - 34 - 8);
      }
      await shot(page, `insets-${size.width}`);
    });
  });
}
