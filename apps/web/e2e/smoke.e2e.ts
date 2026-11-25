/**
 * Smoke test of the main loop, in demo mode and in browser-storage mode (OPFS, the real
 * services over a fake language server and AnkiConnect): import a pasted text, open it, click
 * a word (grammar and Add to Anki show), change the text size (the reader really changes) and
 * answer one practice exercise; in native mode, add a word and review it.
 */
import { type Page, expect, test } from "@playwright/test";
import { finishOnboarding } from "./onboarding.js";
import { fakeAnki } from "./fakeAnki.js";
import { SAMPLE_TEXT, fakeNlp } from "./fakeNlp.js";

/** Collect console errors and uncaught page errors; the smoke flow must end with none. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    // A word without a recorded clip is a 404 the browser logs; the app then uses the system voice.
    if (m.type() === "error" && !m.location().url.includes("/nlp/audio/")) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function importAndRead(page: Page): Promise<void> {
  await page.goto("/import");
  await page.getByLabel("Text", { exact: true }).fill(SAMPLE_TEXT);
  await page.getByRole("button", { name: "Add to my texts" }).click();
  await expect(page).toHaveURL(/\/read\//);
  await expect(page.locator(".k-reader .k-tok").first()).toBeVisible();
}

async function inspectWord(page: Page): Promise<void> {
  await page.locator(".k-reader .k-tok", { hasText: /^buurvrouw$/ }).click();
  const panel = page.getByRole("region", { name: "Grammar of this word" });
  await expect(panel).toContainText("de-word");
  // Without Anki the 5000 common words have cards already (m5): Study first instead of Add.
  await expect(page.getByRole("button", { name: /^(Add to |Study first)/ }).first()).toBeVisible();
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
  // A right answer to a quick choice (de or het) goes on by itself; others wait for Continue.
  const cont = page.getByRole("button", { name: /Continue/ });
  const second = page.getByText(/^2 of \d+$/);
  await expect(cont.or(second)).toBeVisible();
  if (await cont.isVisible()) await cont.click();
  await expect(second).toBeVisible();
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

test("demo mode: side by side", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/?demo");
  await page.goto("/read/t-regen");
  await page.getByRole("tab", { name: "Side by side" }).click();
  const rows = page.locator(".k-sbs-row");
  await expect(rows).toHaveCount(2);
  const row = rows.nth(1);
  const nl = row.locator(".k-sbs-nl");
  const en = row.locator(".k-sbs-en");
  await expect(en).toContainText("we stayed inside");
  // Desktop: the English stands beside the Dutch.
  const [a, b] = [await nl.boundingBox(), await en.boundingBox()];
  expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);

  await row.locator('[data-side="nl"]', { hasText: /^bleven$/ }).hover();
  await expect(row.locator('[data-side="en"]', { hasText: /^stayed$/ })).toHaveAttribute(
    "data-active",
    "",
  );
  await row.getByRole("button", { name: "Structure" }).click();
  await expect(row.getByText("Verb at the end.")).toBeVisible();

  // Phone width: the English sits under its Dutch sentence.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await en.boundingBox())!.y)
    .toBeGreaterThan((await nl.boundingBox())!.y + 10);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test("browser storage mode", async ({ page }) => {
  const errors = watchErrors(page);
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await finishOnboarding(page);
  await importAndRead(page);
  await inspectWord(page);
  await page
    .getByRole("button", { name: /^(Add to |Study first)/ })
    .first()
    .click();
  await expect(
    page.getByText(/Added to your words|Moved to the front of the queue/).first(),
  ).toBeVisible();
  await expect(page.locator(".inspector-panel")).toContainText("Your card");
  await changeTextSize(page);
  // Without Anki, Vuurtoren keeps the cards: the word is waiting in Review.
  await page.goto("/review");
  await expect(page.locator(".review-word")).toContainText("buurvrouw");
  expect(errors).toEqual([]);
});

test("native mode: start with the most common words, offline data in the app", async ({ page }) => {
  const errors = watchErrors(page);
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await page.getByRole("radio", { name: /^No/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  // No level question: the 500 most common words, from the first one (m5).
  await page.getByRole("button", { name: "Continue" }).click();
  // Three questions, then the story at the learner's level opens in the reader.
  await page.getByRole("button", { name: "Start reading" }).click();
  // The story opens, then the walkthrough starts on Read (it reopens the story for its reader
  // steps), so the reader's URL is only there for a moment.
  // The walkthrough follows the welcome once; it can be skipped.
  await expect(page.getByRole("dialog", { name: "Read" })).toBeVisible();
  await page.getByRole("button", { name: "Skip the tour" }).click();
  // The tour's first step shows Read; skipping it leaves you there.
  await expect(page.getByRole("heading", { level: 1, name: "Read" })).toBeVisible();
  await page.goto("/review");
  // New words start with the first 500: a card is waiting.
  await expect(page.locator(".review-word")).toBeVisible();
  expect(errors).toEqual([]);
});

test("native mode: add a word while reading, then review it", async ({ page }) => {
  const errors = watchErrors(page);
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await page.getByRole("radio", { name: /^No/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Start reading" }).click();
  // The story opens, then the walkthrough starts on Read (it reopens the story for its reader
  // steps), so the reader's URL is only there for a moment.
  // The walkthrough follows the welcome once; it can be skipped.
  await expect(page.getByRole("dialog", { name: "Read" })).toBeVisible();
  await page.getByRole("button", { name: "Skip the tour" }).click();
  await importAndRead(page);
  await inspectWord(page);
  await page
    .getByRole("button", { name: /^(Add to |Study first)/ })
    .first()
    .click();
  await expect(page.locator(".inspector-panel")).toContainText("Your card");
  // Saved before leaving the page.
  await expect(
    page.getByText(/^(Moved to the front of the queue|Added to your words)$/),
  ).toBeVisible();
  await page.goto("/review");
  await expect(page.locator(".review-word")).toContainText("buurvrouw");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: /Easy/ })).toBeVisible();
  await page.keyboard.press("4");
  // The next card is another of the day's words.
  await expect(page.locator(".review-word")).not.toContainText("buurvrouw");
  expect(errors).toEqual([]);
});
