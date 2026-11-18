/**
 * Smoke test of the main loop, in demo mode and in browser-storage mode (OPFS, the real
 * services over a fake language server and AnkiConnect): import a pasted text, open it, click
 * a word (grammar and Add to Anki show), change the text size (the reader really changes) and
 * answer one practice exercise.
 */
import { type Page, expect, test } from "@playwright/test";
import { fakeAnki } from "./fakeAnki.js";
import { SAMPLE_TEXT, fakeNlp } from "./fakeNlp.js";

async function importAndRead(page: Page): Promise<void> {
  await page.goto("/import");
  await page.getByLabel("Text", { exact: true }).fill(SAMPLE_TEXT);
  await page.getByRole("button", { name: "Import" }).click();
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
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
  // Keys work for every exercise kind: 1 picks the first choice (or types "1"), Enter checks.
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Continue/ })).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText(/^2 of \d+$/)).toBeVisible();
}

test("demo mode", async ({ page }) => {
  await page.goto("/?demo");
  await importAndRead(page);
  await inspectWord(page);
  await changeTextSize(page);
  await answerOneExercise(page);
});

test("browser storage mode", async ({ page }) => {
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
});
