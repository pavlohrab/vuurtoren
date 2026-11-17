/**
 * The reader's "help" dial: which words get an inline translation.
 *
 *   help 0            Off — pure reading
 *   help (0, 1/3]     New words — words you have not studied (gloss + introduce labels)
 *   help (1/3, 1]     + shaky words — also learning/known words whose recall is below a
 *                     threshold rising linearly to 0.95 ("everything except solidly known")
 *
 * Clozes, ignored words and punctuation never get a translation from the dial (clozes show
 * their meaning as a hint instead).
 */
import type { PlannedToken } from "./types.js";

export const HELP_OFF = 0.05;
export const HELP_NEW_ONLY = 1 / 3;
export const HELP_MAX_RECALL = 0.95;

/** Recall threshold below which studied words are translated at this help level. */
export function helpRecallThreshold(help: number): number {
  if (help <= HELP_NEW_ONLY) return 0;
  const t = ((Math.min(1, help) - HELP_NEW_ONLY) / (1 - HELP_NEW_ONLY)) * HELP_MAX_RECALL;
  return Math.round(t * 1000) / 1000;
}

export function wantsGloss(p: Pick<PlannedToken, "label" | "pKnown">, help: number): boolean {
  if (help <= HELP_OFF) return false;
  switch (p.label) {
    case "gloss":
    case "introduce":
    case "new":
      return true;
    case "learning":
    case "known":
      return p.pKnown < helpRecallThreshold(help);
    default:
      return false;
  }
}

/** Token indices to translate for a set of planned tokens. */
export function glossTargets(tokens: readonly PlannedToken[], help: number): number[] {
  return tokens.filter((t) => wantsGloss(t, help)).map((t) => t.i);
}

export type HelpLevel = "off" | "new" | "shaky" | "most";

export function helpLevel(help: number): HelpLevel {
  if (help <= HELP_OFF) return "off";
  if (help <= HELP_NEW_ONLY) return "new";
  return helpRecallThreshold(help) < 0.6 ? "shaky" : "most";
}
