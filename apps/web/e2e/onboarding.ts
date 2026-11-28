import type { Page } from "@playwright/test";

/**
 * Answer onboarding the shortest way, as a learner would (it can't be skipped): no Anki, no
 * server on a phone, the 500 most common words (always added without Anki), skip Practice, say
 * Not yet to every word of Check your level, then Start reading and skip the tour. Ends in the
 * reader of the suggested story, or on Read.
 */
export async function finishOnboarding(page: Page): Promise<void> {
  await page.getByRole("button", { name: "No" }).click({ timeout: 40_000 });
  // A phone asks about syncing next; a computer goes straight to the starter words.
  const starter = page.getByRole("heading", { name: "You start with the 500 most common words" });
  const notNow = page.getByRole("button", { name: "Not now" });
  await starter.or(notNow).first().waitFor();
  if (await notNow.isVisible()) await notNow.click();
  await starter.waitFor();
  await page.getByRole("button", { name: "Next" }).click();
  await checkLevel(page);
  await page.getByRole("button", { name: "Skip the tour" }).click();
}

/** From the 500 words' screen on: skip Practice, Not yet to every word, Start reading. */
export async function checkLevel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Skip" }).click({ timeout: 40_000 });
  const notYet = page.getByRole("button", { name: "Not yet" });
  for (let i = 0; i < 20; i++) await notYet.click();
  await page.getByRole("button", { name: "Start reading" }).click();
}
