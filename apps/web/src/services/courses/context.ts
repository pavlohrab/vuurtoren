/** What every course module shares: the dependencies and a few lookups. */
import { AnkiConnectClient } from "@app/anki";
import {
  type Block,
  type LanguageProfile,
  type LearnerModel,
  type Unit,
  type UnitWord,
  type WordData,
  migratedProfile,
  normalizeKey,
} from "@app/core";
import type { KenningRepository, WordInfo } from "@app/db";
import { type NlpClient } from "@app/nlp-client";
import type { ImportInput, Settings } from "../types.js";

export interface LiveCoursesDeps {
  repo: KenningRepository;
  settings: () => Promise<Settings>;
  /** The language profile (deck routing); defaults to the old target deck for everything. */
  profile?: () => Promise<LanguageProfile>;
  nlp: () => Promise<NlpClient>;
  anki: () => Promise<AnkiConnectClient>;
  /** Adds a text to the Library (analysing it); returns its id. */
  importText: (input: ImportInput) => Promise<string>;
  model: () => Promise<LearnerModel>;
  /** The engine's WordData for some words (shared with practice: `buildWordData`). */
  wordData: (
    lang: string,
    entries: readonly { key: string; info: WordInfo | null }[],
  ) => Promise<WordData[]>;
  /** Called after changes that make cached learner data stale. */
  changed: () => void;
  now?: () => number;
  /** Polling interval of the OCR job in ms (shortened in tests). */
  pollMs?: number;
  /** Where the pending import is remembered (default: localStorage, or memory). */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Deck names for the Add to Anki picker (the profile's deck choices). */
  deckOptions?: () => Promise<string[]>;
}

type CourseRecord = Awaited<ReturnType<KenningRepository["courses"]>>[number];

export interface CourseContext {
  deps: LiveCoursesDeps;
  repo: KenningRepository;
  clock: () => number;
  courseOrThrow: (courseId: string) => Promise<CourseRecord>;
  keyOf: (w: UnitWord) => string;
  /** The learner's words by key. */
  wordMap: () => Promise<Map<string, WordInfo>>;
  currentProfile: () => Promise<LanguageProfile>;
}

export function createCourseContext(deps: LiveCoursesDeps): CourseContext {
  const { repo } = deps;
  async function courseOrThrow(courseId: string) {
    const c = (await repo.courses()).find((x) => x.id === courseId);
    if (!c) throw new Error("This course no longer exists.");
    return c;
  }

  async function wordMap(): Promise<Map<string, WordInfo>> {
    const lang = (await deps.settings()).lang;
    return new Map((await repo.words(lang)).map((w) => [w.key, w]));
  }

  async function currentProfile(): Promise<LanguageProfile> {
    const s = await deps.settings();
    return deps.profile ? deps.profile() : migratedProfile(s.lang, s.targetDeck, []);
  }

  return {
    deps,
    repo,
    clock: deps.now ?? Date.now,
    courseOrThrow,
    keyOf: (w) => normalizeKey(w.lemma),
    wordMap,
    currentProfile,
  };
}

/** Sentences of a unit's pages (reading texts and exercise items), 4 to 25 words. */
export function unitSentences(blocks: readonly Block[], unit: Unit): string[] {
  const text = blocks
    .filter((b) => b.page >= unit.pages[0] && b.page <= unit.pages[1])
    .map((b) => b.text.replace(/-\n(?=\p{Ll})/gu, "").replace(/\n/g, " "))
    .join(" ");
  return (text.match(/[^.!?]*\p{L}[^.!?]*[.!?]/gu) ?? [])
    .map((x) =>
      x
        .replace(/\s+/g, " ")
        .replace(/^[\d\W]+/u, "")
        .trim(),
    )
    .filter((x) => {
      const n = x.match(/\p{L}+/gu)?.length ?? 0;
      return n >= 4 && n <= 25 && !x.includes("____") && /^\p{Lu}/u.test(x);
    });
}
