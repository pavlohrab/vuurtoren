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
