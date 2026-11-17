import type { AnalyzedToken, SegmentPlan, StaircaseState, WordState } from "@app/core";
import type { StoredText, TextSummary, WordInfo } from "@app/db";
import type { InspectorEntry } from "@app/ui";

/** Defined in @app/ui (the WordInspector consumes it); re-exported here as part of the contract. */
export type { InspectorEntry };

export interface ReadingView {
  text: StoredText;
  tokens: AnalyzedToken[];
  plans: SegmentPlan[];
  staircase: StaircaseState;
}
export interface TextListItem extends TextSummary {
  coverage: number | null;
  newTypes: number | null;
}
export interface Settings {
  ankiUrl: string;
  ankiKey?: string;
  nlpUrl: string;
  lang: "nl";
  targetDeck: string;
  theme: "system" | "light" | "dark";
}
export type ImportInput =
  | { kind: "paste"; title?: string; content: string }
  | { kind: "url"; url: string }
  | { kind: "pdf" | "image"; file: File; title?: string };
export interface AnkiStatus {
  connected: boolean;
  version?: number;
  error?: string;
}
export interface LearnerSummary {
  known: number;
  learning: number;
  unknown: number;
  vocabEstimate: number;
  lastSync: number | null;
  sources: string[];
}

/**
 * Everything the UI needs from the outside world. The app never talks to the database,
 * AnkiConnect or the NLP server directly; swap the implementation passed to <ServicesProvider>.
 */
export interface AppServices {
  listTexts(): Promise<TextListItem[]>;
  getReading(textId: string): Promise<ReadingView | null>;
  importText(input: ImportInput, onProgress?: (msg: string) => void): Promise<string>;
  deleteText(textId: string): Promise<void>;
  inspect(textId: string, tokenIndex: number): Promise<InspectorEntry>;
  addToAnki(entry: InspectorEntry): Promise<{ noteId: number }>;
  setWordState(key: string, state: WordState): Promise<void>;
  recordLookup(textId: string, key: string): Promise<void>;
  finishSegment(
    textId: string,
    segment: number,
    outcome: { clozeAccuracy: number | null; lookupsPer100: number },
  ): Promise<StaircaseState>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  ankiStatus(): Promise<AnkiStatus>;
  syncAnki(onProgress?: (msg: string) => void): Promise<LearnerSummary>;
  learnerSummary(): Promise<LearnerSummary>;
  words(opts?: {
    state?: WordState;
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<WordInfo[]>;
}
