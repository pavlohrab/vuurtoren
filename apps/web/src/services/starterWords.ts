/**
 * The starter word list (`content/starter/nl-5000.json`, built by
 * `server/nlp/scripts/build_starter.py`), shipped with the app as a chunk of its own: loaded on
 * first use, then cached, so it works offline in the browser and the desktop app.
 */
import type { StarterWord } from "@app/anki";

let words: Promise<StarterWord[]> | null = null;

/** The 5000 most common Dutch words, most common first. */
export function loadStarterWords(): Promise<StarterWord[]> {
  words ??= import("../../../../content/starter/nl-5000.json").then(
    (m) => (m.default as { words: StarterWord[] }).words,
  );
  return words;
}
