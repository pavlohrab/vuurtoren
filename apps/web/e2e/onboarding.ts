import type { Page } from "@playwright/test";

/**
 * Answer onboarding the shortest way, as a learner would (it can't be skipped): no Anki, no
 * server on a phone, no starter words unless asked, then Start reading and skip the tour.
 * Ends in the reader of the suggested story.
 */
export async function finishOnboarding(
  page: Page,
  { starter = false }: { starter?: boolean } = {},
): Promise<void> {
  await page.getByRole("radio", { name: /^No/ }).check({ timeout: 40_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  // A phone asks about a server next; a computer goes straight to the starter words.
  const starterBox = page.getByRole("checkbox", { name: /Start with the most common words/ });
  const notNow = page.getByRole("button", { name: "Not now" });
  await starterBox.or(notNow).first().waitFor();
  if (await notNow.isVisible()) await notNow.click();
  if (!starter) await starterBox.uncheck();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Start reading" }).click();
  await page.getByRole("button", { name: "Skip the tour" }).click();
}
