/**
 * Book mode as one flow (algorithms.md 3.9): the scrub bar, the end of the text, the place kept
 * over a reload, Focus mode, and the reading modes in a spread. On the first story a new learner
 * gets, which is longer than one screen.
 */
import { expect, test, type Page } from "@playwright/test";
import { fakeAnki } from "./fakeAnki.js";
import { fakeNlp } from "./fakeNlp.js";
import { finishOnboarding } from "./onboarding.js";

async function open(page: Page, w: number, h: number, prefs: object = {}) {
  await page.setViewportSize({ width: w, height: h });
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await finishOnboarding(page);
  await page.evaluate(
    (p) => localStorage.setItem("vuurtoren-reader-prefs", JSON.stringify(p)),
    prefs,
  );
  await page.reload();
  await page.locator(".book .k-reader .k-tok").first().waitFor();
  await page.waitForTimeout(800);
}

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("phone: scrub to the end and turn past it to the finish, with its checkmark", async ({
  page,
}) => {
  const errors = watch(page);
  await open(page, 412, 900);
  const range = page.locator(".book-scrub input");
  const max = Number(await range.getAttribute("max"));
  await range.evaluate((el, max) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      String(max),
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, max);
  await expect(page.locator(".book-left")).not.toHaveText(/^0%/);
  const vp = (await page.locator(".book-vp").boundingBox())!;
  await page.mouse.click(404, vp.y + vp.height / 2);
  await expect(page.locator(".text-done-check")).toBeVisible();
  await expect(page.getByText(/You read all \d+ words/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("phone: the place survives a reload, and Focus mode is one tap away", async ({ page }) => {
  const errors = watch(page);
  await open(page, 412, 900);
  const vp = (await page.locator(".book-vp").boundingBox())!;
  await page.mouse.click(404, vp.y + vp.height / 2);
  const where = page.locator(".book-left");
  await expect(where).not.toHaveText(/^0%/);
  const at = await where.textContent();
  await page.waitForTimeout(2500); // the place is saved a little after the turns stop
  await page.reload();
  await page.locator(".book .k-reader .k-tok").first().waitFor();
  await expect(where).toHaveText(at ?? "");
  await page.getByRole("button", { name: "Focus mode (F)" }).click();
  await expect
    .poll(() => page.evaluate(() => "readingFocus" in document.documentElement.dataset))
    .toBe(true);
  expect(errors).toEqual([]);
});

test("computer: Gloss gives help across the flow in a sepia book", async ({ page }) => {
  const errors = watch(page);
  await open(page, 1440, 900, { theme: "sepia" });
  await expect(page.locator(".book[data-spread]")).toBeVisible();
  await page.getByRole("tab", { name: "Gloss" }).click();
  await expect
    .poll(() => page.locator(".book rt, .book [class*=gloss]").count())
    .toBeGreaterThan(10);
  await page.getByRole("tab", { name: "Read" }).click();
  expect(errors).toEqual([]);
});
