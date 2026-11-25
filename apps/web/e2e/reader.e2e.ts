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
  await page.getByRole("button", { name: /^Legend .*De koe op de toren/ }).click();
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
  await page.getByRole("button", { name: /^Legend .*De koe op de toren/ }).click();
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
  await page.getByRole("button", { name: /^Legend .*De koe op de toren/ }).click();
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
  await page.getByRole("button", { name: /^Legend .*De koe op de toren/ }).click();
  const word = page.locator(".k-reader .k-tok", { hasText: /^staat$/ }).first();
  await word.click();
  const panel = page.locator(".inspector-panel");
  const head = panel.locator(".k-inspector-surface");
  await expect(head).toHaveText("staat");
  await panel.getByRole("button", { name: "opstaan" }).click();
  await expect(head).toHaveText("opstaan");
  // Never a second panel: the same one, with the way back on top; the text's word stays outlined.
  await expect(page.locator(".inspector-panel")).toHaveCount(1);
  await expect(word).toHaveAttribute("data-selected", "true");
  await panel.getByRole("button", { name: "← staan" }).click();
  await expect(head).toHaveText("staat");
  // Esc goes back one word first, then closes the card.
  await panel.getByRole("button", { name: "toestaan" }).click();
  await expect(head).toHaveText("toestaan");
  await page.keyboard.press("Escape");
  await expect(head).toHaveText("staat");
});
