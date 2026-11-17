/**
 * The language profile (ADR 0010): per language, which Anki decks Kenning reads (confirmed by
 * the user; detection is only a suggestion) and where new words go. Pure data and rules, shared
 * by the web app, the database projections and the MCP server.
 */
import { normalizeKey } from "./match.js";

/** A deck the user confirmed as a source of known words. Missing fields are auto-detected. */
export interface ProfileSource {
  deck: string;
  /** Note type in that deck (detected); absent = every note type detection accepts. */
  modelName?: string;
  wordField?: string;
  sentenceField?: string;
  glossField?: string;
}

/** Where a word was added from. Each can have its own destination deck. */
export type AddSource = "reading" | "converse" | "ai" | "mcp" | "course";

/** Destination deck names. Unset per-source entries fall back to `default`. */
export interface ProfileDestinations {
  default: string;
  reading?: string;
  converse?: string;
  ai?: string;
  mcp?: string;
}

/**
 * Where words added from a course go: one subdeck per unit
 * (`Kenning::<Lang>::<Course>::<Unit>`), one deck per course (`Kenning::<Lang>::<Course>`), or
 * the default deck.
 */
export type CourseDeckMode = "unit" | "course" | "default";

export interface LanguageProfile {
  lang: string;
  sources: ProfileSource[];
  destinations: ProfileDestinations;
  courseDecks: CourseDeckMode;
  /** Tags put on every note Kenning adds for this language (e.g. the language code). */
  tags: string[];
}

/** Languages the app knows about; only the enabled ones can be chosen. */
export const PROFILE_LANGUAGES: {
  code: string;
  name: string;
  english: string;
  enabled: boolean;
}[] = [
  { code: "nl", name: "Nederlands", english: "Dutch", enabled: true },
  { code: "uk", name: "Українська", english: "Ukrainian", enabled: false },
];

/** Native name of a language, used in deck names ("Nederlands"). */
export function langName(lang: string): string {
  return PROFILE_LANGUAGES.find((l) => l.code === lang)?.name ?? lang.toUpperCase();
}

/** Root deck of a language: `Kenning::Nederlands`. */
export function rootDeck(lang: string): string {
  return `Kenning::${langName(lang)}`;
}

/** A fresh profile: everything goes to `Kenning::<Lang>` (reading/Converse/AI subdecks). */
export function defaultProfile(lang: string, sources: ProfileSource[] = []): LanguageProfile {
  const root = rootDeck(lang);
  return {
    lang,
    sources,
    destinations: {
      default: root,
      reading: `${root}::Reading`,
      converse: `${root}::Converse`,
      ai: `${root}::Stories`,
    },
    courseDecks: "unit",
    tags: [lang],
  };
}

/**
 * Profile for a user from before profiles existed: their old target deck receives everything
 * (no per-source subdecks, course words too) and the decks of their last sync stay the sources,
 * so nothing changes for them.
 */
export function migratedProfile(
  lang: string,
  targetDeck: string | undefined,
  lastSources: string[],
): LanguageProfile {
  const deck = targetDeck?.trim() || rootDeck(lang);
  return {
    lang,
    sources: [...new Set(lastSources)].filter((d) => d !== deck).map((d) => ({ deck: d })),
    destinations: { default: deck },
    courseDecks: "default",
    tags: [lang],
  };
}

/** Anki deck names cannot contain `"`, and `::` separates levels: keep titles tidy. */
function deckPart(s: string): string {
  return s.replace(/::+/g, " ").replace(/["]/g, "").replace(/\s+/g, " ").trim() || "Untitled";
}

/** What the word is being added from, for deck resolution. */
export interface AddContext {
  source: AddSource;
  /** Course words: the course and unit titles. */
  course?: { title: string; unitTitle?: string };
  /** An explicit choice from the deck picker wins over every rule. */
  deck?: string;
}

/** The deck a new word goes to. */
export function resolveDeck(profile: LanguageProfile, ctx: AddContext): string {
  if (ctx.deck?.trim()) return ctx.deck.trim();
  const d = profile.destinations;
  if (ctx.source === "course") {
    if (ctx.course && profile.courseDecks !== "default") {
      const course = `${rootDeck(profile.lang)}::${deckPart(ctx.course.title)}`;
      if (profile.courseDecks === "course" || !ctx.course.unitTitle) return course;
      return `${course}::${deckPart(ctx.course.unitTitle)}`;
    }
    return d.default;
  }
  return d[ctx.source]?.trim() || d.default;
}

/** Every destination deck of a profile (deduplicated, default first). */
export function destinationDecks(profile: LanguageProfile): string[] {
  const d = profile.destinations;
  return [
    ...new Set([d.default, d.reading, d.converse, d.ai, d.mcp].filter((x): x is string => !!x)),
  ];
}

/** Tags for a note added from `source`: the profile's tags plus `kenning::from::<source>`. */
export function noteTags(
  profile: LanguageProfile,
  source: AddSource,
  extra: string[] = [],
): string[] {
  return [...new Set([...profile.tags, `kenning::from::${source}`, ...extra])];
}

const ARTICLES: Record<string, RegExp> = { nl: /^(de|het|een|'t)$/i };
const REFLEXIVES: Record<string, RegExp> = { nl: /^(zich|me|je|ons|jullie)$/i };

/**
 * The one learner-model key rule for a word added to Anki. An analysed key (from the reader's
 * token matching) wins; otherwise the headword is reduced to its lemma: a leading article or
 * reflexive pronoun is dropped ("de fiets" -> "fiets", "zich vergissen" -> "vergissen") and the
 * result normalised, so the card matches in the reader and the Words list.
 */
export function wordKey(lang: string, word: string, analysedKey?: string): string {
  if (analysedKey?.trim()) return normalizeKey(analysedKey);
  const words = word.trim().split(/\s+/);
  const art = ARTICLES[lang];
  const refl = REFLEXIVES[lang];
  if (art && words.length > 1 && art.test(words[0] ?? "")) words.shift();
  if (refl && words.length > 1 && refl.test(words[0] ?? "")) words.shift();
  return normalizeKey(words.join(" "));
}

/** True if the value has the shape of a LanguageProfile (for data read back from storage). */
export function isLanguageProfile(v: unknown): v is LanguageProfile {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<LanguageProfile>;
  return (
    typeof p.lang === "string" &&
    Array.isArray(p.sources) &&
    !!p.destinations &&
    typeof p.destinations.default === "string" &&
    Array.isArray(p.tags)
  );
}
