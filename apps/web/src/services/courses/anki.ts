/** Course words and Anki: deck mapping, Learn next, adding a unit's words. */
import { addWord, studyNativeFirst, studyWordsFirst } from "@app/anki";
import {
  type LanguageProfile,
  type Unit,
  type UnitWord,
  profileMode,
  resolveDeck,
  suggestDecks,
} from "@app/core";
import type {
  AddMissingResult,
  AddWordRow,
  AddWordsPreview,
  CourseServices,
  DeckMapping,
  LearnNextResult,
} from "../courseTypes.js";
import { type CourseContext, unitSentences } from "./context.js";

/** A card-sized gloss: the first two senses without their explanations in brackets. */
function shortGloss(senses: readonly string[]): string {
  const clean = senses
    .map((g) =>
      g
        .replace(/\s*\([^)]*\)/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const out: string[] = [];
  for (const g of clean) {
    if (out.length >= 2 || [...out, g].join("; ").length > 60) break;
    if (!out.includes(g)) out.push(g);
  }
  return out.join("; ") || (clean[0] ?? "").slice(0, 60);
}

export function createCourseAnki(ctx: CourseContext) {
  const { deps, repo, courseOrThrow, keyOf, wordMap, currentProfile } = ctx;

  async function deckMapping(courseId: string): Promise<DeckMapping> {
    const course = await courseOrThrow(courseId);
    let decks: string[] = [];
    const profile = await currentProfile();
    if (profileMode(profile) === "native") {
      // Native mode: Vuurtoren's own decks; Anki is not asked.
      decks = (await repo.nativeDecks(profile.lang, ctx.clock())).map((d) => d.name).sort();
    } else {
      try {
        decks = (await (await deps.anki()).deckNames()).sort();
      } catch {
        // Anki not reachable: the user can still continue without a mapping.
      }
    }
    const themes = course.units.filter((u) => u.kind === "theme");
    const sug = suggestDecks(themes, decks);
    return {
      decks,
      suggested: Object.fromEntries(sug.map((s) => [s.n, s.decks])),
      current: Object.fromEntries(course.units.map((u) => [u.n, u.ankiDecks])),
    };
  }

  async function mapDecks(courseId: string, mapping: Record<number, string[]>): Promise<void> {
    const course = await courseOrThrow(courseId);
    const lang = (await deps.settings()).lang;
    const all = await repo.words(lang);
    for (const unit of course.units) {
      const decks = mapping[unit.n];
      if (!decks) continue;
      await repo.append({ type: "UnitEdited", courseId, n: unit.n, patch: { ankiDecks: decks } });
      // Without a word list, the unit's words are the notes of its decks.
      if (decks.length > 0 && (await repo.unitWords(courseId, unit.n)).length === 0) {
        const words: UnitWord[] = all
          .filter((w) => w.decks.some((d) => decks.includes(d)))
          .map((w) => ({
            lemma: w.key,
            source: "anki" as const,
            ...(w.article ? { article: w.article } : {}),
            ...(w.gloss ? { gloss: w.gloss } : {}),
          }));
        if (words.length > 0)
          await repo.append({ type: "UnitWordsSet", courseId, unitN: unit.n, words });
      }
    }
    deps.changed();
  }

  async function learnNextForUnit(courseId: string, n: number): Promise<LearnNextResult> {
    const lang = (await deps.settings()).lang;
    const infos = await wordMap();
    const keys = [...new Set((await repo.unitWords(courseId, n)).map(keyOf))];
    const total = keys.length;
    const withNotes = keys
      .flatMap((k) => infos.get(k) ?? [])
      .filter((w) => w.noteIds.length > 0 && w.state !== "known");
    if (withNotes.length === 0) return { moved: 0, skipped: total };
    if (profileMode(await currentProfile()) === "native") {
      // Native mode: the new cards of the unit's words go to the front, in the unit's order.
      const status = await repo.nativeNoteStatus(
        lang,
        withNotes.flatMap((w) => w.noteIds),
        Date.now(),
      );
      const cardIds = status.flatMap((s) =>
        s.cards.filter((c) => c.type === "new").map((c) => c.cardId),
      );
      const words = new Set(
        status.filter((s) => s.cards.some((c) => c.type === "new")).map((s) => s.noteId),
      );
      const moved = withNotes.filter((w) => w.noteIds.some((id) => words.has(id))).length;
      if (cardIds.length > 0) {
        await studyNativeFirst((e) => repo.append(e), { lang, cardIds });
      }
      deps.changed();
      return { moved, skipped: total - moved };
    }
    // In the unit's word order, so Anki introduces the words as the book does.
    const { moved } = await studyWordsFirst(
      await deps.anki(),
      (e) => repo.append(e),
      lang,
      withNotes,
    );
    deps.changed();
    return { moved, skipped: total - moved };
  }

  async function addMissingUnitWords(
    courseId: string,
    n: number,
    opts?: { deck?: string },
  ): Promise<AddMissingResult> {
    return addUnitWords(courseId, n, opts?.deck ? { deck: opts.deck } : {});
  }

  /**
   * Finder of a sentence of the unit's pages that uses a word: the lemma itself, or a form
   * sharing its stem ("fietst" for "fietsen"). Indexes the words of the sentences once.
   */
  function exampleFinder(sentences: readonly string[]): (lemma: string) => string | undefined {
    const first = new Map<string, number>();
    sentences.forEach((x, i) => {
      for (const w of x.toLowerCase().match(/\p{L}+/gu) ?? []) if (!first.has(w)) first.set(w, i);
    });
    const words = [...first.keys()];
    return (lemma) => {
      const l = lemma.toLowerCase();
      if (l.length < 2) return undefined;
      if (/\s/.test(l)) return sentences.find((x) => x.toLowerCase().includes(l));
      const exact = first.get(l);
      if (exact !== undefined) return sentences[exact];
      const stem = l.length >= 5 ? l.replace(/(en|e|n)$/u, "") : l;
      let best: number | undefined;
      for (const w of words) {
        if (w.length > stem.length + 3 || !w.startsWith(stem)) continue;
        const i = first.get(w) ?? Infinity;
        if (best === undefined || i < best) best = i;
      }
      return best === undefined ? undefined : sentences[best];
    };
  }

  /** Where a unit's new words go: the per-unit rule prefers the Anki deck the unit is mapped to. */
  function unitDeck(profile: LanguageProfile, courseTitle: string, unit: Unit): string {
    if (profile.courseDecks === "unit" && unit.ankiDecks[0]) return unit.ankiDecks[0];
    return resolveDeck(profile, {
      source: "course",
      course: { title: courseTitle, unitTitle: unit.title },
    });
  }

  async function addWordsPreview(
    courseId: string,
    scope: number | "all",
  ): Promise<AddWordsPreview> {
    const course = await courseOrThrow(courseId);
    const units = course.units.filter((u) =>
      scope === "all" ? u.kind === "theme" || u.kind === "other" : u.n === scope,
    );
    const [infos, blocks, profile] = await Promise.all([
      wordMap(),
      repo.courseBlocks(courseId),
      currentProfile(),
    ]);
    const rows: AddWordRow[] = [];
    const seen = new Set<string>();
    for (const unit of units) {
      const exampleFor = exampleFinder(unitSentences(blocks, unit));
      for (const w of await repo.unitWords(courseId, unit.n)) {
        const key = keyOf(w);
        if (seen.has(key)) continue;
        seen.add(key);
        const info = infos.get(key);
        const example = w.example ?? exampleFor(w.lemma);
        rows.push({
          key,
          lemma: w.lemma,
          unitN: unit.n,
          status:
            info?.state === "known" ? "known" : info && info.noteIds.length > 0 ? "in-anki" : "new",
          ...(w.article ? { article: w.article } : {}),
          ...(w.gloss ? { gloss: w.gloss } : {}),
          ...(example ? { example } : {}),
        });
      }
    }
    // Glosses (and de/het) from the dictionary for words the book list does not gloss.
    const missing = rows.filter((r) => r.status === "new" && !r.gloss).map((r) => r.lemma);
    if (missing.length > 0 && course.lang === "nl") {
      try {
        const found = await (await deps.nlp()).gloss("nl", missing);
        for (const r of rows) {
          const g = found[r.lemma]?.[0];
          if (!g) continue;
          if (!r.gloss && g.glosses[0]) r.gloss = shortGloss(g.glosses);
          if (!r.article && g.article && g.article !== "de/het") r.article = g.article;
        }
      } catch {
        // The dictionary is optional: words go to Anki without a gloss.
      }
    }
    // Deck suggestions are optional (Anki may be closed): the default decks are still offered.
    const options: string[] = deps.deckOptions ? await deps.deckOptions().catch(() => []) : [];
    const decks = Object.fromEntries(units.map((u) => [u.n, unitDeck(profile, course.title, u)]));
    return {
      rows,
      decks,
      options: [...new Set([...Object.values(decks), ...options])],
    };
  }

  async function addUnitWords(
    courseId: string,
    scope: number | "all",
    opts: { keys?: string[]; deck?: string } = {},
  ): Promise<AddMissingResult> {
    const course = await courseOrThrow(courseId);
    const preview = await addWordsPreview(courseId, scope);
    const wanted = opts.keys ? new Set(opts.keys) : null;
    const rows = preview.rows.filter(
      (r) => r.status === "new" && (wanted ? wanted.has(r.key) : true),
    );
    const profile = await currentProfile();
    const slug = course.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let added = 0;
    let failed = 0;
    let lastDeck = opts.deck ?? Object.values(preview.decks)[0] ?? profile.destinations.default;
    for (const r of rows) {
      const unit = course.units.find((u) => u.n === r.unitN);
      const deck = opts.deck ?? preview.decks[r.unitN];
      try {
        const res = await addWord(deps.anki, (e) => repo.append(e), {
          profile,
          context: {
            source: "course",
            course: { title: course.title, ...(unit ? { unitTitle: unit.title } : {}) },
            ...(deck ? { deck } : {}),
          },
          word: r.article ? `${r.article} ${r.lemma}` : r.lemma,
          key: r.key,
          source: course.title,
          extraTags: [`vuurtoren::course::${slug}::${r.unitN}`],
          ...(r.gloss ? { gloss: r.gloss } : {}),
          ...(r.example ? { sentence: r.example } : {}),
        });
        lastDeck = res.deck;
        added++;
      } catch {
        // Counted and returned to the screen, which reports how many words failed.
        failed++;
      }
    }
    deps.changed();
    return { added, failed, deck: lastDeck };
  }

  return {
    deckMapping,
    mapDecks,
    learnNextForUnit,
    addMissingUnitWords,
    addWordsPreview,
    addUnitWords,
  } satisfies Partial<CourseServices>;
}
