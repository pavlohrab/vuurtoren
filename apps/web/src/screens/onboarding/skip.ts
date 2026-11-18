import { readLocal, writeLocal } from "../../storage/local.js";

/** "Skip setup" flag of the onboarding wizard (kept apart so the shell loads it cheaply). */
const SKIPPED = "kenning.onboarding.skipped";

/** The learner chose "Skip setup" (the app then stops sending them to /welcome). */
export function onboardingSkipped(): boolean {
  return readLocal(SKIPPED) === "1";
}

export function setSkipped(on: boolean): void {
  writeLocal(SKIPPED, on ? "1" : null);
}
