/** Demo language profile, deck suggestions and placement words (?demo). */
import { type AddSource, type LanguageProfile, defaultProfile, resolveDeck } from "@app/core";
import { placementBands } from "./placementWords.js";
import type { DeckSuggestion, ProfileServices } from "./profileTypes.js";

const SUGGESTIONS: DeckSuggestion[] = [
  {
    deck: "Dutch::Core 2k",
    modelName: "Basic (and reversed card)",
    noteCount: 2000,
    wordField: "Front",
    sentenceField: "Example",
    glossField: "Back",
    examples: ["de fiets", "gezellig", "lopen"],
    suggested: true,
  },
  {
    deck: "A Frequency Dictionary of Dutch",
    modelName: "Frequency",
    noteCount: 5000,
    wordField: "Word",
    sentenceField: null,
    glossField: "Definition",
    examples: ["het", "zijn", "hebben"],
    suggested: true,
  },
  {
    deck: "Opmaat::Thema 01 - Kennismaken",
    modelName: "Opmaat",
    noteCount: 48,
    wordField: "Woord",
    sentenceField: "Zin",
    glossField: "Betekenis",
    examples: ["de naam", "wonen", "de straat"],
    suggested: false,
  },
];

export const DEMO_ANKI_DECKS = [
  "A Frequency Dictionary of Dutch",
  "Dutch::Core 2k",
  "Opmaat::Thema 01 - Kennismaken",
  "Opmaat::Thema 02 - Wonen",
];

export function createMockProfile(wait: () => Promise<void>) {
  let profile: LanguageProfile = defaultProfile(
    "nl",
    SUGGESTIONS.filter((s) => s.suggested).map(({ deck, modelName, wordField }) => ({
      deck,
      modelName,
      wordField,
    })),
  );
  const known = new Set<string>();
  const deckFor = (source: AddSource, deck?: string) =>
    resolveDeck(profile, { source, ...(deck ? { deck } : {}) });

  const services: ProfileServices = {
    async languageProfile() {
      await wait();
      return profile;
    },
    async saveLanguageProfile(p) {
      await wait();
      profile = p;
    },
    async suggestDecks() {
      await wait();
      return SUGGESTIONS;
    },
    async deckChoices(source, course) {
      await wait();
      const deck = resolveDeck(profile, {
        source,
        ...(course ? { course: { title: "Opmaat", unitTitle: `Thema ${course.unitN}` } } : {}),
      });
      return {
        deck,
        options: [
          ...Object.entries(profile.destinations).map(([k, v]) => ({
            deck: v,
            group: "kenning" as const,
            hint: k === "default" ? "Default" : k[0]!.toUpperCase() + k.slice(1),
          })),
          ...(source === "course" ? [{ deck, group: "course" as const, hint: "This unit" }] : []),
          ...DEMO_ANKI_DECKS.map((d) => ({ deck: d, group: "anki" as const })),
        ],
      };
    },
    async placementWords() {
      return placementBands("nl");
    },
    async savePlacement(keys) {
      await wait();
      for (const k of keys) known.add(k);
    },
  };
  return { services, deckFor };
}
