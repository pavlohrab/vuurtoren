/**
 * Smoke test of the main loop, in demo mode and in browser-storage mode (OPFS, the real
 * services over a fake language server and AnkiConnect): import a pasted text, open it, click
 * a word (grammar and Add to Anki show), change the text size (the reader really changes) and
 * answer one practice exercise; in native mode, add a word and review it.
 */
import { type Page, expect, test } from "@playwright/test";
import { fakeAnki } from "./fakeAnki.js";
import { SAMPLE_TEXT, fakeNlp } from "./fakeNlp.js";

/** Collect console errors and uncaught page errors; the smoke flow must end with none. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function importAndRead(page: Page): Promise<void> {
  await page.goto("/import");
  await page.getByLabel("Text", { exact: true }).fill(SAMPLE_TEXT);
  await page.getByRole("button", { name: "Add to Library" }).click();
  await expect(page).toHaveURL(/\/read\//);
  await expect(page.locator(".k-reader .k-tok").first()).toBeVisible();
}

async function inspectWord(page: Page): Promise<void> {
  await page.locator(".k-reader .k-tok", { hasText: /^buurvrouw$/ }).click();
  const panel = page.getByRole("region", { name: "Grammar of this word" });
  await expect(panel).toContainText("de-word");
  await expect(page.getByRole("button", { name: /^Add to / })).toBeVisible();
}

async function changeTextSize(page: Page): Promise<void> {
  const text = page.locator(".k-reader").first();
  const before = await text.evaluate((el) => getComputedStyle(el).fontSize);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Larger text" }).click();
  await expect
    .poll(() => text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeGreaterThan(parseFloat(before));
  await page.keyboard.press("Escape");
}

async function answerOneExercise(page: Page): Promise<void> {
  await page.goto("/practice");
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
  // Keys work for every exercise kind: 1 picks the first choice (or types "1"), Enter checks.
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Continue/ })).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText(/^2 of \d+$/)).toBeVisible();
}

test("demo mode", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/?demo");
  await importAndRead(page);
  await inspectWord(page);
  await changeTextSize(page);
  await answerOneExercise(page);
  expect(errors).toEqual([]);
});

test("browser storage mode", async ({ page }) => {
  const errors = watchErrors(page);
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Skip setup for now" }).click();
  await importAndRead(page);
  await inspectWord(page);
  await page.getByRole("button", { name: /^Add to / }).click();
  await expect(page.locator(".inspector-panel")).toContainText("Learning");
  await changeTextSize(page);
  await answerOneExercise(page);
  expect(errors).toEqual([]);
});

test("native mode: start with the most common words, offline data in the app", async ({ page }) => {
  const errors = watchErrors(page);
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await page.getByRole("radio", { name: /^No/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("radio", { name: /About 500 words/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Go to the Library" }).click();
  await page.goto("/review");
  // Words 1–500 are known; the first new card is the most common word after them.
  await expect(page.locator(".review-word")).toBeVisible();
  await expect(page.locator(".review-word")).not.toContainText(/^(de|zijn|van)$/);
  expect(errors).toEqual([]);
});

test("native mode: add a word while reading, then review it", async ({ page }) => {
  const errors = watchErrors(page);
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await page.getByRole("radio", { name: /^No/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("button", { name: "Skip this" }).click();
  await page.getByRole("button", { name: "Go to the Library" }).click();
  await importAndRead(page);
  await inspectWord(page);
  await expect(page.getByRole("group", { name: "Add to my words" })).toBeVisible();
  await page.getByRole("button", { name: /^Add to / }).click();
  await expect(page.locator(".inspector-panel")).toContainText("Your card");
  await page.goto("/review");
  await expect(page.locator(".review-word")).toContainText("buurvrouw");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: /Easy/ })).toBeVisible();
  await page.keyboard.press("4");
  await expect(page.getByRole("heading", { name: "Done for now" })).toBeVisible();
  expect(errors).toEqual([]);
});
