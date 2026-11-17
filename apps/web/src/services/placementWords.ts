/**
 * Placement check for "start fresh" users (ADR 0010): 60 Dutch words in four frequency bands
 * (rough SUBTLEX-NL ranks). Ticked words are recorded as manual known marks, app-only.
 */
import { normalizeKey } from "@app/core";
import type { PlacementBand } from "./profileTypes.js";

const BANDS: [string, [string, string][]][] = [
  [
    "Among the 100 most common",
    [
      ["zijn", "to be"],
      ["hebben", "to have"],
      ["gaan", "to go"],
      ["goed", "good"],
      ["groot", "big"],
      ["de dag", "day"],
      ["de man", "man"],
      ["de vrouw", "woman"],
      ["de tijd", "time"],
      ["het jaar", "year"],
      ["het kind", "child"],
      ["het huis", "house"],
      ["zien", "to see"],
      ["weten", "to know"],
      ["nieuw", "new"],
    ],
  ],
  [
    "Top 500",
    [
      ["het werk", "work"],
      ["de stad", "city"],
      ["de vriend", "friend"],
      ["het water", "water"],
      ["het boek", "book"],
      ["vragen", "to ask"],
      ["lopen", "to walk"],
      ["eten", "to eat"],
      ["morgen", "tomorrow"],
      ["kopen", "to buy"],
      ["oud", "old"],
      ["de deur", "door"],
      ["het geld", "money"],
      ["de school", "school"],
      ["slapen", "to sleep"],
    ],
  ],
  [
    "Top 2,000",
    [
      ["de fiets", "bicycle"],
      ["de keuken", "kitchen"],
      ["zwaar", "heavy"],
      ["gezellig", "cosy"],
      ["verhuizen", "to move house"],
      ["belangrijk", "important"],
      ["de regen", "rain"],
      ["de winkel", "shop"],
      ["het ziekenhuis", "hospital"],
      ["de verjaardag", "birthday"],
      ["leeg", "empty"],
      ["beslissen", "to decide"],
      ["gevaarlijk", "dangerous"],
      ["vergeten", "to forget"],
      ["de buurman", "neighbour"],
    ],
  ],
  [
    "Top 5,000",
    [
      ["ondertussen", "meanwhile"],
      ["verwaarlozen", "to neglect"],
      ["bezorgd", "worried"],
      ["het aanrecht", "kitchen counter"],
      ["de schaamte", "shame"],
      ["nauwelijks", "hardly"],
      ["verbouwen", "to renovate"],
      ["de kraan", "tap"],
      ["inmiddels", "by now"],
      ["aanvragen", "to apply for"],
      ["toegeven", "to admit"],
      ["zorgvuldig", "careful"],
      ["het uitstel", "postponement"],
      ["beleefd", "polite"],
      ["de gewoonte", "habit"],
    ],
  ],
];

/** The placement bands for a language (only Dutch has a list so far). */
export function placementBands(lang: string): PlacementBand[] {
  if (lang !== "nl") return [];
  return BANDS.map(([label, words]) => ({
    label,
    words: words.map(([word, gloss]) => ({
      key: normalizeKey(word.replace(/^(de|het) /, "")),
      word,
      gloss,
    })),
  }));
}
