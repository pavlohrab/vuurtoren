import { readLocal } from "../../storage/local.js";

/** Where the onboarding wizard keeps its step and answers (kept apart so the shell reads it cheaply). */
export const ONBOARDING_DRAFT = "vuurtoren.onboarding";

/**
 * Onboarding was started and not finished. The profile is saved early (after "Do you use
 * Anki?"), so a profile alone doesn't mean it's done: the app sends the learner back until the
 * last step clears the draft.
 */
export function onboardingUnfinished(): boolean {
  return readLocal(ONBOARDING_DRAFT) !== null;
}
