/**
 * Live language profile: load / migrate / save the profile, deck suggestions,
 * deck choices for the AddToAnki picker, the placement check, and the snapshot sources.
 * Works in both storage modes: everything goes through the repository contract.
 */
import {
  type AnkiConnectClient,
  type Candidate,
  NOTE_TYPE,
  buildSnapshot,
  detectSources,
  profileSources,
  setAppWordState,
} from "@app/anki";
import {
  type AddContext,
  type AddSource,
  type LanguageProfile,
  defaultProfile,
  migratedProfile,
  resolveDeck,
  isLanguageProfile,
  profileMode,
} from "@app/core";
import type { VuurtorenRepository } from "@app/db";
import type { NlpClient } from "@app/nlp-client";
import type { DeckOption } from "@app/ui";
import { placementBands } from "./placementWords.js";
import type {
  CourseDeckContext,
  DeckChoices,
  DeckSuggestion,
  ProfileServices,
} from "./profileTypes.js";
import { DecksNotChosenError } from "./profileErrors.js";
import type { Settings } from "./types.js";

export interface LiveProfileDeps {
  repo: VuurtorenRepository;
  settings: () => Promise<Settings>;
  anki: (timeoutMs?: number) => Promise<AnkiConnectClient>;
  nlp: () => Promise<NlpClient>;
  changed: () => void;
}

/** How long the picker waits for Anki's deck list before offering only Vuurtoren's decks. */
const DECKS_TIMEOUT_MS = 3000;

const DEST_HINT: Record<string, string> = {
  default: "Default",
  reading: "Reading",
  converse: "Talk",
  ai: "AI stories",
  mcp: "MCP",
};

export function createLiveProfile(deps: LiveProfileDeps) {
  const { repo } = deps;
  let cache: { lang: string; profile: LanguageProfile | null } | null = null;

  /** Stored profile, or one migrated from the old target deck and last sync (saved once). */
  async function load(): Promise<LanguageProfile | null> {
    const { lang } = await deps.settings();
    if (cache?.lang === lang) return cache.profile;
    let profile = await repo.languageProfile(lang);
    if (profile && !isLanguageProfile(profile)) profile = null;
    if (!profile) {
      const saved = await repo.setting<Partial<Settings>>("settings");
      const snap = await repo.lastSnapshot(lang);
      if (snap || saved?.targetDeck) {
        profile = migratedProfile(lang, saved?.targetDeck, snap?.sources ?? []);
        await repo.append({ type: "LanguageProfileSet", profile });
      }
    }
    cache = { lang, profile };
    return profile;
  }

  /**
   * The profile for writes: a learner who skipped onboarding gets the defaults, connected to
   * Anki as before modes existed.
   */
  async function current(): Promise<LanguageProfile> {
    return (await load()) ?? defaultProfile((await deps.settings()).lang, [], "connected");
  }

  async function courseContext(c?: CourseDeckContext): Promise<AddContext["course"]> {
    if (!c) return undefined;
    const course = (await repo.courses()).find((x) => x.id === c.courseId);
    if (!course) return undefined;
    const unit = course.units.find((u) => u.n === c.unitN);
    return { title: course.title, ...(unit ? { unitTitle: unit.title } : {}) };
  }

  async function snapshotDeps(onProgress?: (m: string) => void) {
    const { lang } = await deps.settings();
    const client = await deps.nlp();
    return {
      anki: await deps.anki(),
      lang,
      detect: (texts: string[]) => client.detect(texts),
      analyzeTerms: (terms: string[]) => client.analyzeTerms(lang, terms),
      ...(onProgress ? { onProgress } : {}),
    };
  }

  const services: ProfileServices = {
    languageProfile: load,

    async saveLanguageProfile(profile) {
      await repo.append({ type: "LanguageProfileSet", profile });
      cache = { lang: profile.lang, profile };
      deps.changed();
    },

    async suggestDecks(): Promise<DeckSuggestion[]> {
      const profile = await load();
      const d = await snapshotDeps();
      const confirmed = profile?.sources.map((s) => s.deck) ?? [];
      const { candidates, selected } = await detectSources({ ...d, alwaysInclude: confirmed });
      const picked = new Set<Candidate>(selected);
      return candidates
        .filter((c) => c.modelName !== NOTE_TYPE)
        .map((c) => ({
          deck: c.deck,
          modelName: c.modelName,
          noteCount: c.noteCount,
          wordField: c.wordField,
          sentenceField: c.sentenceField,
          glossField: c.glossField,
          examples: c.examples.filter(Boolean).slice(0, 3),
          suggested: picked.has(c),
        }));
    },

    async deckChoices(source: AddSource, course?: CourseDeckContext): Promise<DeckChoices> {
      const profile = await current();
      const ctx = await courseContext(course);
      const deck = resolveDeck(profile, { source, ...(ctx ? { course: ctx } : {}) });
      const options: DeckOption[] = [];
      for (const [k, v] of Object.entries(profile.destinations)) {
        if (typeof v === "string" && v)
          options.push({ deck: v, group: "vuurtoren", hint: DEST_HINT[k] ?? k });
      }
      if (source === "course" && ctx) {
        options.push({ deck, group: "course", hint: ctx.unitTitle ?? ctx.title });
      }
      for (const c of await repo.courses()) {
        for (const u of c.units) {
          for (const d of u.ankiDecks) options.push({ deck: d, group: "course", hint: u.title });
        }
      }
      if (profileMode(profile) === "native") {
        // Native mode: Vuurtoren's own decks; Anki is not asked.
        for (const d of await repo.nativeDecks(profile.lang, Date.now())) {
          options.push({ deck: d.name, group: "anki" });
        }
        return { deck, options };
      }
      try {
        const names = await (await deps.anki(DECKS_TIMEOUT_MS)).deckNames();
        for (const d of names.sort()) if (d !== "Default") options.push({ deck: d, group: "anki" });
      } catch {
        // Anki unreachable: Vuurtoren's own and course decks are still offered.
      }
      return { deck, options };
    },

    async placementWords() {
      return placementBands((await deps.settings()).lang);
    },

    async savePlacement(knownKeys) {
      const { lang } = await deps.settings();
      for (const key of new Set(knownKeys)) {
        await setAppWordState((e) => repo.append(e), lang, key, "known");
      }
      deps.changed();
    },
  };

  /**
   * Snapshot of the profile's confirmed sources plus destination and course-mapped decks.
   * @throws DecksNotChosenError when no profile exists yet (new user who skipped onboarding).
   */
  async function snapshot(onProgress?: (m: string) => void) {
    const profile = await load();
    if (!profile) throw new DecksNotChosenError();
    const d = await snapshotDeps(onProgress);
    const courseDecks = (await repo.courses()).flatMap((c) => c.units.flatMap((u) => u.ankiDecks));
    const sources = await profileSources(d, profile, courseDecks);
    return buildSnapshot(d, sources);
  }

  return { services, current, snapshot, invalidate: () => (cache = null) };
}

export type LiveProfile = ReturnType<typeof createLiveProfile>;
