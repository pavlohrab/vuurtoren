/** "Skip setup" flag of the onboarding wizard (kept apart so the shell loads it cheaply). */
const SKIPPED = "kenning.onboarding.skipped";

/** The learner chose "Skip setup" (the app then stops sending them to /welcome). */
export function onboardingSkipped(): boolean {
  try {
    return localStorage.getItem(SKIPPED) === "1";
  } catch {
    // storage blocked: onboarding is shown (expected)
    return false;
  }
}

export function setSkipped(on: boolean): void {
  try {
    if (on) localStorage.setItem(SKIPPED, "1");
    else localStorage.removeItem(SKIPPED);
  } catch {
    // storage unavailable: the choice lasts for this visit only
  }
}
