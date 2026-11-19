/** Contract of the language profile, deck routing and onboarding services. */
import type { AddSource, LanguageProfile } from "@app/core";
import type { DeckOption } from "@app/ui";

export type { AddSource };

/** A deck detection suggests as a source of known words. */
export interface DeckSuggestion {
  deck: string;
  modelName: string;
  noteCount: number;
  wordField: string;
  sentenceField: string | null;
  glossField: string | null;
  /** Up to three headwords from the word field, as a preview. */
  examples: string[];
  /** Detection is confident this is target-language vocabulary (pre-ticked). */
  suggested: boolean;
}

/** Where a word from `source` goes now, plus every deck the picker offers. */
export interface DeckChoices {
  deck: string;
  options: DeckOption[];
}

/** Course unit context for course words. */
export interface CourseDeckContext {
  courseId: string;
  unitN: number;
}

/** A word of the placement check. */
interface PlacementWord {
  key: string;
  /** As shown, e.g. "de fiets". */
  word: string;
  gloss: string;
}

/** Words of one frequency band, e.g. "Most common 100". */
export interface PlacementBand {
  label: string;
  words: PlacementWord[];
}

/** The add-to-Anki methods take an explicit picker choice. */
export interface AddOptions {
  deck?: string;
}

export interface ProfileServices {
  /**
   * The current language's profile. Users from before profiles get one built from their old
   * target deck and last sync (saved once). Null for a new user: show onboarding.
   */
  languageProfile(): Promise<LanguageProfile | null>;
  saveLanguageProfile(profile: LanguageProfile): Promise<void>;
  /** Run deck detection on the user's Anki collection (rejects when Anki is unreachable). */
  suggestDecks(): Promise<DeckSuggestion[]>;
  /** The deck a new word from `source` goes to and the picker's choices. */
  deckChoices(source: AddSource, course?: CourseDeckContext): Promise<DeckChoices>;
  /** About 60 frequency-ranked words in bands for the start-fresh placement check. */
  placementWords(): Promise<PlacementBand[]>;
  /** Record the ticked placement words as known in the app only (never written to Anki). */
  savePlacement(knownKeys: string[]): Promise<void>;
}
