/**
 * The reader as a book (BookPages.tsx): on a phone a page is cut into screens that turn
 * sideways; on a computer it is a two-page spread. The first story a new learner gets has
 * pages longer than one phone screen. `BOOK_SHOTS=<dir>` also saves screenshots there (phone
 * and computer, light and dark).
 */
import { type Page, expect, test } from "@playwright/test";
import { fakeAnki } from "./fakeAnki.js";
import { fakeNlp } from "./fakeNlp.js";
import { finishOnboarding } from "./onboarding.js";

const SHOTS = process.env["BOOK_SHOTS"];

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** A new learner, in the reader of the story onboarding suggests. */
async function openStory(page: Page): Promise<void> {
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await finishOnboarding(page);
  await expect(page.locator(".book .k-reader .k-tok").first()).toBeVisible();
  await page.waitForTimeout(600);
}

/** A point in the middle third of the page that is not on a word. */
async function emptyMiddle(page: Page): Promise<{ x: number; y: number }> {
  const spot = await page.evaluate(() => {
    const r = document.querySelector(".book-vp")!.getBoundingClientRect();
    for (let y = r.top + 4; y < r.bottom - 4; y += 3) {
      for (let x = r.left + r.width * 0.4; x < r.left + r.width * 0.6; x += 4) {
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest(".k-tok, a, button, input, .k-gmark")) return { x, y };
      }
    }
    return null;
  });
  expect(spot).not.toBeNull();
  return spot!;
}

test.describe("phone 412px", () => {
  test.use({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true });

  test("a word low on the screen stays above the word card", async ({ page }) => {
    await openStory(page);
    // The lowest word on this screen.
    const i = await page.evaluate(() => {
      const vp = document.querySelector(".book-vp")!.getBoundingClientRect();
      let best: { i: string; y: number } | null = null;
      for (const el of document.querySelectorAll<HTMLElement>(".book .k-tok[data-i]")) {
        const r = el.getBoundingClientRect();
        if (r.left < vp.left || r.right > vp.right || r.bottom > vp.bottom) continue;
        if (!best || r.top > best.y) best = { i: el.dataset["i"]!, y: r.top };
      }
      return best?.i ?? null;
    });
    expect(i).not.toBeNull();
    const word = page.locator(`.book .k-tok[data-i="${i}"]`);
    await word.click();
    const sheet = page.locator(".inspector-panel");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(700);
    const w = (await word.boundingBox())!;
    const s = (await sheet.boundingBox())!;
    expect(w.y + w.height).toBeLessThanOrEqual(s.y);
    await shot(page, "book-phone-word-low");
  });

  test("a tap on the right side turns to the next screen of the page", async ({ page }) => {
    await openStory(page);
    const counter = page.locator(".book-screens");
    const pageCount = page.locator(".reader-pager-count [aria-hidden]");
    await expect(counter).toHaveText(/^Screen 1 of \d+$/);
    await expect(pageCount).toHaveText(/^1 \/ \d+$/);
    // The text area is one screen wide: nothing sticks out.
    const vp = (await page.locator(".book-vp").boundingBox())!;
    expect(vp.x + vp.width).toBeLessThanOrEqual(412);
    await shot(page, "book-phone-light");

    // The right margin is not a word: a tap there turns the screen, not the page.
    await page.mouse.click(404, vp.y + vp.height / 2);
    await expect(counter).toHaveText(/^Screen 2 of \d+$/);
    await expect(pageCount).toHaveText(/^1 \/ \d+$/);
    await shot(page, "book-phone-screen2");

    // A tap on the left side goes back.
    await page.mouse.click(8, vp.y + vp.height / 2);
    await expect(counter).toHaveText(/^Screen 1 of \d+$/);
  });

  test("a tap in the middle hides the bars, another brings them back", async ({ page }) => {
    await openStory(page);
    const spot = await emptyMiddle(page);
    await page.mouse.click(spot.x, spot.y);
    await expect(page.locator("html")).toHaveAttribute("data-book-bare", "");
    await expect(page.locator(".topbar")).toHaveCSS("opacity", "0");
    await shot(page, "book-phone-bare");
    await page.mouse.click(spot.x, spot.y);
    await expect(page.locator("html")).not.toHaveAttribute("data-book-bare", "");
  });

  test("dark, and a word's card", async ({ page }) => {
    test.skip(!SHOTS, "screenshots only");
    await page.emulateMedia({ colorScheme: "dark" });
    await openStory(page);
    await shot(page, "book-phone-dark");
    // A word low on the screen: the text lifts so it stays above the card.
    const words = page.locator(".book .k-tok[data-i]");
    const low = await words.evaluateAll((els) => {
      const r = document.querySelector(".book-vp")!.getBoundingClientRect();
      const i = els.findIndex((el) => {
        const b = el.getBoundingClientRect();
        return b.left >= r.left && b.right <= r.right && b.bottom > r.bottom - 60;
      });
      return i;
    });
    await words.nth(Math.max(0, low)).click();
    await page.waitForTimeout(600);
    await shot(page, "book-phone-word-dark");
  });
});

test.describe("computer 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a page is a two-page spread, turned as one", async ({ page }) => {
    await openStory(page);
    await expect(page.locator(".book")).toHaveAttribute("data-spread", "");
    await shot(page, "book-desk-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "book-desk-dark");
  });
});
