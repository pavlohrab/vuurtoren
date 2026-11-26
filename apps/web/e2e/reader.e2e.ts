/** The reader on a computer: what you click is drawn as selected, at once. */
import { expect, test } from "@playwright/test";
import { fakeAnki } from "./fakeAnki.js";
import { fakeNlp } from "./fakeNlp.js";
import { finishOnboarding } from "./onboarding.js";

test("the clicked word has its outline while its sheet is open", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await finishOnboarding(page);
  await page.goto("/");
  await page
    .getByRole("region", { name: /^A1/ })
    .getByRole("button", { name: "De koe op de toren" })
    .click();
  const word = page.locator(".k-reader .k-tok[data-i]").nth(5);
  await word.click();
  await expect(word).toHaveAttribute("data-selected", "true");
  // The click also gives it the focus; the outline must not disappear because of that.
  await expect(word).toBeFocused();
  expect(await word.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
});

test("a grammar topic opened from the reader goes back to the text, the word still selected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await finishOnboarding(page);
  await page.goto("/");
  await page
    .getByRole("region", { name: /^A1/ })
    .getByRole("button", { name: "De koe op de toren" })
    .click();
  const word = page.locator(".k-reader .k-tok[data-i]").nth(3);
  await word.click();
  const index = await word.getAttribute("data-i");
  const url = page.url();
  await page.getByRole("button", { name: "Grammar: Separable verbs" }).first().click();
  await page.getByRole("link", { name: "Open the topic", exact: true }).click();
  await expect(page).toHaveURL(/\/grammar\/separable-verbs/);
  await page.getByRole("link", { name: "Back to the text" }).click();
  await expect(page).toHaveURL(url);
  await expect(page.locator(`.k-reader .k-tok[data-i="${index}"]`)).toHaveAttribute(
    "data-selected",
    "true",
  );
});

test("the word panel and the sidebar can be made wider or narrower", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await finishOnboarding(page);
  await page.goto("/");
  await page
    .getByRole("region", { name: /^A1/ })
    .getByRole("button", { name: "De koe op de toren" })
    .click();
  await page.locator(".k-reader .k-tok[data-i]").nth(3).click();
  const panel = page.locator(".inspector-panel");
  await expect(panel).toHaveCSS("width", "340px");
  const handle = page.getByRole("separator", { name: "Word panel width" });
  // A thin strip on the edge, never over the card's content.
  expect((await handle.boundingBox())!.width).toBeLessThan(10);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 117, box.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect(panel).toHaveCSS("width", "460px");
  // The keyboard works too, and the sidebar has its own handle.
  const side = page.getByRole("separator", { name: "Sidebar width" });
  await side.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".sidebar")).toHaveCSS("width", "236px");
  // Kept for the next visit.
  await page.reload();
  await page.locator(".k-reader .k-tok[data-i]").nth(3).click();
  await expect(panel).toHaveCSS("width", "460px");
});

test("a word opened from the card replaces it, and Back goes back one word", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await finishOnboarding(page);
  await page.goto("/");
  await page
    .getByRole("region", { name: /^A1/ })
    .getByRole("button", { name: "De koe op de toren" })
    .click();
  const word = page.locator(".k-reader .k-tok", { hasText: /^staat$/ }).first();
  await word.click();
  const panel = page.locator(".inspector-panel");
  const head = panel.locator(".k-inspector-surface");
  // The dictionary word on top, the page's form and what it is under it (RD2).
  await expect(head).toHaveText("staan");
  await expect(panel.locator(".k-inspector-lemma")).toHaveText(/^staat · present, /);
  await panel.getByRole("button", { name: "opstaan" }).click();
  await expect(head).toHaveText("opstaan");
  // Never a second panel: the same one, with the way back on top; the text's word stays outlined.
  await expect(page.locator(".inspector-panel")).toHaveCount(1);
  await expect(word).toHaveAttribute("data-selected", "true");
  await panel.getByRole("button", { name: "← staan" }).click();
  await expect(head).toHaveText("staan");
  // Esc goes back one word first, then closes the card.
  await panel.getByRole("button", { name: "toestaan" }).click();
  await expect(head).toHaveText("toestaan");
  await page.keyboard.press("Escape");
  await expect(head).toHaveText("staan");
});

test("Words on a computer: the Inbox (folders, the words, the chosen word)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await finishOnboarding(page);
  await page.getByRole("link", { name: "Words" }).first().click();
  await expect(page).toHaveURL(/\/words\/all\?layout=list/);
  const rail = page.getByRole("navigation", { name: "Your words" });
  await expect(rail.getByRole("link", { name: "Start review" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "All words" })).toBeVisible();
  const pane = page.getByRole("complementary", { name: "The chosen word" });
  await expect(pane.getByRole("button", { name: "Open word card" })).toBeVisible();
  // The three columns fit: nothing wider than the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});

test("Full entry: wider, words open inside it, Esc steps back, grammar comes back to it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await finishOnboarding(page);
  await page.goto("/");
  await page
    .getByRole("region", { name: /^A1/ })
    .getByRole("button", { name: "De koe op de toren" })
    .click();
  await page
    .locator(".k-reader .k-tok", { hasText: /^staat$/ })
    .first()
    .click();
  const panel = page.locator(".inspector-panel");
  await expect(panel).toHaveCSS("width", "340px");
  await panel.getByRole("button", { name: "Full entry ⤢" }).click();
  const wide = async () => (await panel.boundingBox())!.width;
  await expect.poll(wide).toBeGreaterThan(500);
  await expect(panel.locator(".full-entry-senses")).toContainText("to stand");
  // A word clicked in the full entry opens in the full entry (it used to drop back to small).
  await panel.getByRole("button", { name: "opstaan" }).click();
  await expect(panel.locator(".k-inspector-surface")).toHaveText("opstaan");
  await expect.poll(wide).toBeGreaterThan(500);
  // Esc: back one word first, still full; then out of the full entry; the card stays.
  await page.keyboard.press("Escape");
  await expect(panel.locator(".k-inspector-surface")).toHaveText("staan");
  await expect.poll(wide).toBeGreaterThan(500);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCSS("width", "340px");
  await expect(panel.locator(".k-inspector-surface")).toHaveText("staan");
  // A grammar topic from the full entry, and back: the full entry again.
  await panel.getByRole("button", { name: "Full entry ⤢" }).click();
  await expect.poll(wide).toBeGreaterThan(500);
  await panel.getByRole("link", { name: "The present tense" }).first().click();
  await page.getByRole("link", { name: "Back to the text" }).click();
  await expect(panel.locator(".k-inspector-surface")).toHaveText("staan");
  await expect.poll(wide).toBeGreaterThan(500);
});

test("on a phone, a word tapped in the card opens its card in the same sheet", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await fakeNlp(page);
  await fakeAnki(page);
  await page.goto("/");
  await finishOnboarding(page);
  await page.goto("/");
  await page
    .getByRole("region", { name: /^A1/ })
    .getByRole("button", { name: "De koe op de toren" })
    .click();
  await page
    .locator(".k-reader .k-tok", { hasText: /^staat$/ })
    .first()
    .click();
  const panel = page.locator(".inspector-panel");
  await page.getByRole("button", { name: "Show all of the word panel" }).click();
  await panel.getByRole("button", { name: "opstaan" }).click();
  // The sheet stays open with the new word; it used to close (the tap counted as outside).
  await expect(panel.locator(".k-inspector-surface")).toHaveText("opstaan");
  await expect(panel).toHaveAttribute("data-sheet", /peek|full/);
  await panel.getByRole("button", { name: "← staan" }).click();
  await expect(panel.locator(".k-inspector-surface")).toHaveText("staan");
});
