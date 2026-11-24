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
