/**
 * Practice services on top of the local database: builds sessions from the learner model,
 * Anki sentences, the learner's own texts and the NLP server, grades answers with the engine
 * and records them as ExerciseAnswered events. Nothing here writes to Anki.
 */
import {
  type AnalyzedToken,
  type Exercise,
  type ExampleSentence,
  type Grade,
  type ItemState,
  type LearnerModel,
  type Skill,
  type TopicSentence,
  type WordData,
  type WordForms,
  splitVerbs,
  tokenKey,
  normalizeKey,
  sharesMeaning,
} from "@app/core";
import type {
  GeneratedSentence,
  GeneratedSentenceSet,
  VuurtorenRepository,
  WordInfo,
} from "@app/db";
import type { GlossEntry } from "@app/nlp-client";
import {
  STEP_OF,
  buildLesson,
  missesByPoint,
  comeBack as engineComeBack,
  type GrammarPoint,
  type LessonInput,
  buildTopicSession,
  score as lessonScore,
  unknownOthers,
} from "@app/core";
import { lessonSignals, toEloAnswers } from "./lessonSignals.js";
import {
  buildSession,
  checkAnswer,
  createRng,
  gradeAttempt,
  practiceStats,
  review,
} from "../practice/engine.js";
import type { AISentenceReport } from "./aiTypes.js";
import type { SentenceFill, SentenceNeed } from "./liveAI.js";
import type { TopicMaterial } from "./liveGrammar.js";
import type { PracticeData } from "@app/nlp-client";
import { fetchTexts } from "./textBatch.js";
import type {
  AnswerResult,
  AttemptInput,
  PracticeOptions,
  LessonSources,
  PracticeOverview,
  TopicPracticeOptions,
} from "./types.js";

type DictEntries = GlossEntry[];

export interface LivePracticeDeps {
  repo: VuurtorenRepository;
  lang: () => Promise<string>;
  model: () => Promise<LearnerModel>;
  /** Dictionary entries per lemma (empty when the dictionary is unavailable). */
  dictionary: (lemmas: string[]) => Promise<Record<string, DictEntries>>;
  /** Meanings (Anki gloss first) and article of a word. */
  composeGlosses: (
    info: WordInfo | null,
    entries: DictEntries | undefined,
    pos: string,
  ) => { glosses: string[]; article: string | undefined };
  data: PracticeData;
  /** The language server can hear speech (the "say" exercise). */
  canListen?: () => Promise<boolean>;
  /** Offline sentence translation (cached); missing entries when it is unavailable. */
  translate?: (sentences: string[]) => Promise<Map<string, string>>;
  /** Hit sentences and words of a grammar topic (topic exercises). */
  topicMaterial?: (detects: string[]) => Promise<TopicMaterial>;
  /** AI example sentences (docs/ai.md); absent or not ready = no generation. */
  aiSentences?: {
    ready: () => boolean;
    fill: (lang: string, needs: SentenceNeed[], avoid: string[]) => Promise<SentenceFill>;
  };
  now?: () => number;
  /** Native mode: an answer also answers the word's due card (liveNative `evidence`). */
  evidence?: () => { exercise: (key: string, grade: Grade, ms: number) => Promise<unknown> };
}
/** Most words per session that get AI sentences. */
export const AI_WORDS_PER_SESSION = 8;
/** A word with fewer good sentences than this gets AI sentences. */
const AI_GOOD_SENTENCES = 3;
/** A grammar topic with fewer hit sentences than this gets AI sentences. */
const AI_TOPIC_FEW = 6;

/** A stored AI sentence as an example sentence (needs its target span). */
function aiExample(g: GeneratedSentence): ExampleSentence[] {
  if (!g.target) return [];
  const e: ExampleSentence = { text: g.text, target: g.target, source: "ai" };
  if (g.translation) e.translation = g.translation;
  return [e];
}

/** A stored AI grammar sentence as a topic sentence (needs its marks). */
function aiTopicSentence(g: GeneratedSentence): TopicSentence[] {
  const marks = g.marks?.filter(([a, b]) => a >= 0 && a < b && b <= g.text.length);
  if (!marks?.length) return [];
  const [a, b] = marks[0]!;
  const t: TopicSentence = {
    text: g.text,
    marks,
    source: "ai",
    key: normalizeKey(g.text.slice(a, b)),
  };
  if (g.translation) t.translation = g.translation;
  if (g.note) t.note = g.note;
  return [t];
}

const goodSentences = (xs: readonly ExampleSentence[]) =>
  xs.filter((x) => {
    const n = x.text.split(/\s+/).filter(Boolean).length;
    return n >= MIN_SENTENCE_WORDS && n <= MAX_SENTENCE_WORDS;
  }).length;
/** Distinct words a topic session looks up (forms, dictionary). */
const TOPIC_WORDS = 40;

const DEFAULT_SIZE = 20;
/** Most sentences translated for one lesson (the translator is local but not instant). */
const MAX_TRANSLATE = 80;
const DAY_MS = 86_400_000;
/** At most this many tapped words make the "this text" lesson. */
const PAGE_WORDS = 15;
/** The grammar page of each grammar point (for "practise the one you miss most"). */
const TOPIC_OF_POINT: Record<GrammarPoint, string> = {
  gender: "de-het",
  "adjective-e": "adjective-inflection",
  perfect: "perfect-tense",
  separable: "separable-verbs",
  "verb-form": "imperfect-tense",
  "word-order": "word-order-v2",
};
/** Recall at which another word in a sentence counts as known (algorithms.md 4.7.4). */
const KNOWN_RECALL = 0.8;
/** Words in a lesson (algorithms.md 4.7.6). */
const LESSON_WORDS = 10;
/** Exercise kinds the engine knows (older answers of a removed kind are skipped). */
const KNOWN_KINDS: ReadonlySet<string> = new Set(Object.keys(STEP_OF));
const ALL_SKILLS: readonly Skill[] = ["recognition", "recall", "form", "gender", "listening"];
/** Texts scanned for example sentences (most recent first). */
const MAX_TEXTS = 15;
const MIN_SENTENCE_WORDS = 4;
const MAX_SENTENCE_WORDS = 16;
const SENTENCES_PER_WORD = 3;
/** Wiktionary part of speech -> spaCy universal POS, for words absent from the texts. */
const UPOS: Record<string, string> = {
  noun: "NOUN",
  name: "PROPN",
  verb: "VERB",
  adj: "ADJ",
  adv: "ADV",
  pron: "PRON",
  prep: "ADP",
  postp: "ADP",
  num: "NUM",
  conj: "CCONJ",
  intj: "INTJ",
};
const FORM_POS = new Set(["VERB", "ADJ", "NOUN"]);

/** Words that practice offers: those being learned or already known. */
const isPractisable = (w: WordInfo) => w.state === "learning" || w.state === "known";

/** What the texts tell about a word: lemma, part of speech, frequency, usable sentences. */
interface Occurrence {
  lemma: string;
  pos: string;
  zipf: number;
  sentences: ExampleSentence[];
}

/** Surface forms a word is known to take: lemma, server forms and regular suffixes. */
function surfaceForms(lemma: string, pos: string, forms: WordForms | undefined): Set<string> {
  const out = new Set<string>([lemma]);
  const add = (x: string | undefined) => x && out.add(x.toLowerCase());
  if (forms) {
    add(forms.participle);
    forms.past?.forEach(add);
    Object.values(forms.present ?? {}).forEach(add);
    add(forms.plural);
    add(forms.diminutive);
    add(forms.inflected);
    add(forms.comparative);
    add(forms.superlative);
  }
  if (pos === "NOUN") for (const suf of ["s", "en", "je", "tje"]) out.add(lemma + suf);
  if (pos === "ADJ") out.add(lemma + "e");
  if (pos === "VERB" && lemma.endsWith("en") && lemma.length > 4) {
    // Regular conjugation only; the bare stem is left out on purpose ("werken" vs the noun "werk").
    const stem = lemma.slice(0, -2);
    for (const suf of ["t", "te", "ten", "de", "den", "end"]) out.add(stem + suf);
    out.add(`ge${stem}d`).add(`ge${stem}t`);
  }
  return out;
}

/**
 * Find [start, end) of `lemma` or one of its known surface forms in `sentence`: whole-word,
 * case-insensitive, no prefix guessing ("Zij" is not "zijn", "manier" is not "man"). Returns
 * null when the word does not occur, so the caller can drop the sentence.
 *
 * TODO: prefer the note's bold/cloze-marked target (`extractMarked` in @app/anki) once
 * packages/db can carry a `sentenceTarget` for Anki sentences.
 */
export function locateWord(
  sentence: string,
  lemma: string,
  opts: { forms?: WordForms; pos?: string } = {},
): [number, number] | null {
  const known = surfaceForms(lemma.toLowerCase(), opts.pos ?? "", opts.forms);
  for (const m of sentence.matchAll(/\p{L}+/gu)) {
    if (known.has(m[0].toLowerCase())) return [m.index, m.index + m[0].length];
  }
  return null;
}

/** Usable example sentences of the analysed texts, grouped by the practised keys. */
function sentencesFromTexts(
  tokens: AnalyzedToken[],
  content: string,
  model: LearnerModel,
  wanted: Set<string>,
  into: Map<string, Occurrence>,
): void {
  const spans = new Map<number, { start: number; end: number; words: number }>();
  for (const t of tokens) {
    const s = spans.get(t.sent) ?? { start: t.start, end: t.end, words: 0 };
    s.end = t.end;
    if (t.is_word) s.words++;
    spans.set(t.sent, s);
  }
  const split = splitVerbs(tokens);
  for (const t of tokens) {
    if (!t.is_word || t.particle_of !== null) continue;
    const key = tokenKey(t, model, split.has(t.i));
    if (!wanted.has(key)) continue;
    const occ = into.get(key) ?? { lemma: t.lemma, pos: t.pos, zipf: t.zipf, sentences: [] };
    into.set(key, occ);
    const s = spans.get(t.sent);
    if (
      !s ||
      occ.sentences.length >= SENTENCES_PER_WORD ||
      s.words < MIN_SENTENCE_WORDS ||
      s.words > MAX_SENTENCE_WORDS
    ) {
      continue;
    }
    const text = content.slice(s.start, s.end);
    if (text.includes("\n") || occ.sentences.some((x) => x.text === text)) continue;
    occ.sentences.push({ text, target: [t.start - s.start, t.end - s.start], source: "text" });
  }
}

/** Create the practice part of AppServices. */
export function createLivePractice(deps: LivePracticeDeps) {
  /** The running lesson's input, for a missed word's second go. */
  let lastLesson: Omit<LessonInput, "size" | "only"> | null = null;
  const { repo } = deps;
  const clock = deps.now ?? Date.now;

  /** In-memory copy of practice_items per language (avoids re-reading every answer). */
  const itemCache = new Map<string, Map<string, ItemState>>();
  const itemId = (key: string, skill: Skill) => `${key}\u0000${skill}`;

  /** Re-read the items from the database and refresh the cache. */
  async function loadItems(lang: string): Promise<ItemState[]> {
    const items = await repo.practiceItems(lang);
    itemCache.set(lang, new Map(items.map((i) => [itemId(i.key, i.skill), i])));
    return items;
  }

  async function practiceOverview(): Promise<PracticeOverview> {
    const lang = await deps.lang();
    const now = clock();
    const [items, infos, log] = await Promise.all([
      loadItems(lang),
      repo.words(lang),
      repo.practiceLog(lang, 1),
    ]);
    // Only words that can be practised today count (ignored / reset / seen words do not).
    const eligible = new Set(infos.filter(isPractisable).map((w) => w.key));
    const live = items.filter((i) => eligible.has(i.key));
    const stats = practiceStats(live, now);
    const practised = new Set(items.map((i) => i.key));
    return {
      due: stats.due,
      learned: stats.learned,
      bySkill: stats.bySkill,
      newAvailable: infos.filter((w) => w.state === "learning" && !practised.has(w.key)).length,
      lastSession: log[0]?.at ?? null,
      degraded: deps.data.degraded(),
    };
  }

  /** Words worth practising now: due first, then new learning words, then known ones. */
  function chooseWords(
    infos: WordInfo[],
    items: ItemState[],
    skills: Skill[] | undefined,
    cap: number,
    now: number,
    rng: () => number,
  ): WordInfo[] {
    const eligible = new Map(infos.filter(isPractisable).map((w) => [w.key, w]));
    const due = new Set(
      items.filter((i) => i.due <= now && (!skills || skills.includes(i.skill))).map((i) => i.key),
    );
    const practised = new Set(items.map((i) => i.key));
    const learning = [...eligible.values()].filter((w) => w.state === "learning");
    const shuffled = (xs: WordInfo[]) =>
      xs
        .map((w) => [rng(), w] as const)
        .sort((a, b) => a[0] - b[0])
        .map(([, w]) => w);
    const ordered = [
      ...[...due].flatMap((k) => eligible.get(k) ?? []),
      // never practised: shakiest first (recall in 0.1 bands), random within a band — the
      // database order is alphabetical and would always start at "a…"
      ...shuffled(learning.filter((w) => !practised.has(w.key))).sort(
        (a, b) => Math.floor(a.pKnown * 10) - Math.floor(b.pKnown * 10),
      ),
      ...shuffled(learning.filter((w) => practised.has(w.key))),
      ...shuffled([...eligible.values()].filter((w) => w.state === "known")),
    ];
    return [...new Map(ordered.map((w) => [w.key, w])).values()].slice(0, cap);
  }

  async function occurrences(
    keys: Set<string>,
    model: LearnerModel,
  ): Promise<Map<string, Occurrence>> {
    const out = new Map<string, Occurrence>();
    const texts = (await repo.listTexts()).filter((t) => t.analyzed).slice(0, MAX_TEXTS);
    // Batched reads: one call per ~150k words instead of one per text.
    for (const text of await fetchTexts(repo, texts)) {
      if (text.tokens) sentencesFromTexts(text.tokens, text.content, model, keys, out);
    }
    return out;
  }

  /**
   * The engine's WordData for some words, the one assembly used by practice and courses:
   * lemma, part of speech and frequency (zipf) from the learner's texts,
   * dictionary glosses and article, server forms, and example sentences in the order Anki, the
   * learner's texts, earlier AI sentences, Tatoeba. A word absent from every text gets zipf 0
   * (unknown frequency) and its dictionary part of speech.
   */
  async function buildWordData(
    lang: string,
    entries: readonly { key: string; info: WordInfo | null }[],
    model?: LearnerModel,
  ): Promise<{ words: WordData[]; aiByKey: Map<string, GeneratedSentenceSet> }> {
    const occ = await occurrences(
      new Set(entries.map((e) => e.key)),
      model ?? (await deps.model()),
    );
    const dict = await deps.dictionary([
      ...new Set(entries.map((e) => occ.get(e.key)?.lemma ?? e.key)),
    ]);

    const base = entries.map(({ key, info }) => {
      const o = occ.get(key);
      const lemma = o?.lemma ?? key;
      const dictEntries = dict[lemma];
      const pos = o?.pos ?? UPOS[dictEntries?.[0]?.pos ?? ""] ?? "X";
      const { glosses, article } = deps.composeGlosses(info, dictEntries, pos);
      return { key, info, lemma, pos, glosses, article, o };
    });

    const [forms, serverSentences, aiSets] = await Promise.all([
      deps.data.forms(
        lang,
        base.filter((b) => FORM_POS.has(b.pos)).map((b) => ({ lemma: b.lemma, pos: b.pos })),
      ),
      deps.data.sentences(
        lang,
        base.filter((b) => (b.o?.sentences.length ?? 0) < 2).map((b) => b.lemma),
        { limit: 2, maxWords: 14 },
      ),
      repo.generatedSentences(lang),
    ]);
    const aiByKey = new Map<string, GeneratedSentenceSet>(
      aiSets.filter((x) => !x.topic && x.key).map((x) => [x.key, x]),
    );

    const words: WordData[] = base.map(({ key, info, lemma, pos, glosses, article, o }) => {
      const sentences: ExampleSentence[] = [];
      if (info?.sentence) {
        const target = locateWord(info.sentence, lemma, {
          pos,
          ...(forms[lemma] ? { forms: forms[lemma] } : {}),
        });
        if (target) {
          sentences.push({
            text: info.sentence,
            target,
            source: "anki",
            ...(info.sentenceTranslation ? { translation: info.sentenceTranslation } : {}),
          });
        }
      }
      // Anki, then the learner's texts, then earlier AI sentences, then Tatoeba (server).
      sentences.push(
        ...(o?.sentences ?? []),
        ...(aiByKey.get(key)?.sentences.flatMap(aiExample) ?? []),
        ...(serverSentences[lemma] ?? []),
      );
      const word: WordData = {
        key,
        lemma,
        pos,
        glosses,
        zipf: o?.zipf ?? 0,
        state: info?.state ?? "unknown",
        pKnown: info?.pKnown ?? 0,
        sentences,
      };
      if (article && pos === "NOUN" && (article === "de" || article === "het"))
        word.article = article;
      const f = forms[lemma];
      if (f) word.forms = f;
      return word;
    });
    return { words, aiByKey };
  }

  /**
   * A lesson (algorithms.md 4.7): the words with the highest need × use, each at the exercise the
   * Elo model and the guard rail choose. Used unless the learner limited the skills in Options.
   */
  async function startLesson(
    opts: PracticeOptions,
    lang: string,
    now: number,
  ): Promise<Exercise[]> {
    const size = Math.max(1, opts.size ?? LESSON_WORDS);
    const rng = createRng(now);
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const [infos, items, model, rows, reviewed, stair] = await Promise.all([
      repo.words(lang),
      loadItems(lang),
      deps.model(),
      repo.practiceAnswers(lang),
      repo.cardReviewedKeys(lang, midnight.getTime()).catch(() => []),
      repo.staircase(lang).catch(() => null),
    ]);
    const today = new Set(reviewed);
    const answers = toEloAnswers(rows, KNOWN_KINDS);
    const focus = opts.keys ? new Set(opts.keys) : null;
    // A first pass with a neutral frequency picks the pool; word data (with the real frequency)
    // is only built for that pool, because it reads texts and asks the language server.
    const rough = lessonSignals(infos, answers, now, undefined, focus ?? undefined, today).filter(
      (s) => !focus || focus.has(s.key),
    );
    const due = new Set(items.filter((i) => i.due <= now).map((i) => i.key));
    const pool = rough
      .map((s) => ({ s, v: due.has(s.key) ? Infinity : lessonScore(s, now) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v || (a.s.key < b.s.key ? -1 : 1))
      .slice(0, Math.max(30, size * 4))
      .map((x) => x.s.key);
    if (pool.length === 0) return [];
    const byKey = new Map(infos.map((w) => [w.key, w]));
    const { words, aiByKey } = await buildWordData(
      lang,
      pool.map((key) => ({ key, info: byKey.get(key)! })),
      model,
    );
    if (opts.aiSentences) {
      const report = await fillWithAI(lang, words, aiByKey, size);
      opts.onAISentences?.(report);
    }
    await addTranslations(words);
    // How many other words of each sentence you don't know yet (the sentence guard rail, 4.7.4).
    const known = (form: string) => (model.get(form)?.pKnown ?? 0) >= KNOWN_RECALL;
    const practisedKeys = new Set(answers.map((a) => a.key));
    for (const w of words) {
      // Sentence objects can be reused between lessons: set both marks fresh each time.
      for (const x of w.sentences) {
        x.unknown = unknownOthers(x.text, x.target, known);
        delete x.first;
      }
      // The first time, the sentence from your own reading comes first (4.7.4).
      if (!practisedKeys.has(w.key)) {
        const mine = w.sentences.find((x) => x.source === "text");
        if (mine) mine.first = true;
      }
    }
    const zipf = new Map(words.map((w) => [w.key, w.zipf]));
    const inPool = new Set(pool);
    const signals = lessonSignals(
      infos.filter((w) => inPool.has(w.key)),
      answers,
      now,
      (k) => zipf.get(k) ?? 0,
      focus ?? undefined,
      today,
    );
    const speaking = (await deps.canListen?.().catch(() => false)) ?? false;
    lastLesson = { words, signals, states: items, answers, now, speaking };
    const exercises = buildLesson(
      {
        words,
        signals,
        states: items,
        answers,
        size,
        now,
        speaking,
        ...(stair ? { coverage: stair.targetCoverage } : {}),
        ...(focus ? { only: focus } : {}),
      },
      rng,
    );
    return padWordChoices(exercises, words, lang);
  }

  /**
   * The English for sentences that have none (mostly ones from your texts), from the offline
   * translator. A sentence still without English is not used for building (algorithms.md 4.7.4).
   */
  async function addTranslations(words: WordData[]): Promise<void> {
    if (!deps.translate) return;
    const missing = [
      ...new Set(
        words.flatMap((w) => w.sentences.filter((x) => !x.translation).map((x) => x.text)),
      ),
    ].slice(0, MAX_TRANSLATE);
    if (missing.length === 0) return;
    const got = await deps.translate(missing).catch(() => new Map<string, string>());
    for (const w of words)
      for (const x of w.sentences) {
        const t = !x.translation ? got.get(x.text) : undefined;
        if (t) x.translation = t;
      }
  }

  /** The lessons to start from: this text's words, the week's mistakes, a weak grammar point. */
  async function lessonSources(lastText: string | null): Promise<LessonSources> {
    const lang = await deps.lang();
    const now = clock();
    const week = now - 7 * DAY_MS;
    const [rows, texts, infos, items] = await Promise.all([
      repo.practiceAnswers(lang),
      lastText ? repo.listTexts() : Promise.resolve([]),
      repo.words(lang),
      loadItems(lang),
    ]);
    const ignored = new Set(infos.filter((w) => w.state === "ignored").map((w) => w.key));
    let page: LessonSources["page"] = null;
    const text = texts.find((t) => t.id === lastText);
    if (text) {
      const keys = (await repo.lookedUpKeys(lang, text.id)).filter((k) => !ignored.has(k));
      if (keys.length) page = { textId: text.id, title: text.title, keys: keys.slice(-PAGE_WORDS) };
    }
    const answers = toEloAnswers(rows, KNOWN_KINDS);
    // Words whose newest answer this week was wrong.
    const newest = new Map<string, number>();
    for (const a of answers) if (a.at >= week) newest.set(a.key, a.result);
    const mistakes = [...newest].filter(([k, r]) => r < 0.5 && !ignored.has(k)).map(([k]) => k);
    const [point, misses] = [...missesByPoint(answers, week)].sort((a, b) => b[1] - a[1])[0] ?? [];
    const weak =
      point && misses !== undefined && misses >= 2
        ? { topic: TOPIC_OF_POINT[point], misses }
        : null;
    const evening = new Date(now);
    evening.setDate(evening.getDate() + 1);
    evening.setHours(23, 59, 59, 999);
    const tomorrow = [
      ...new Set(
        items
          .filter((i) => i.due > now && i.due <= evening.getTime() && !ignored.has(i.key))
          .map((i) => i.key),
      ),
    ];
    return { page, mistakes, weak, tomorrow };
  }

  /** A missed word's second go, from the lesson that is running. */
  async function comeBack(missed: Exercise): Promise<Exercise | null> {
    if (!lastLesson) return null;
    const miss = { key: missed.key, kind: missed.kind, result: 0, at: clock() };
    const ex = engineComeBack(
      missed,
      { ...lastLesson, answers: [...lastLesson.answers, miss] },
      createRng(clock()),
    );
    return ex ? { ...ex, id: `${ex.id}-again` } : null;
  }

  async function startPractice(opts: PracticeOptions = {}): Promise<Exercise[]> {
    const lang = await deps.lang();
    const now = clock();
    if (!opts.skills || ALL_SKILLS.every((sk) => opts.skills!.includes(sk)))
      return startLesson(opts, lang, now);
    const size = Math.max(1, opts.size ?? DEFAULT_SIZE);
    const rng = createRng(now);
    const [infos, items, model] = await Promise.all([
      repo.words(lang),
      loadItems(lang),
      deps.model(),
    ]);
    // "Practise these words": only the given words, due or not (scheduling is unchanged: the
    // copies below are only marked due so the session builder offers them).
    const focus = opts.keys ? new Set(opts.keys) : null;
    const chosen = focus
      ? infos.filter((w) => focus.has(w.key) && w.state !== "ignored")
      : chooseWords(infos, items, opts.skills, Math.min(120, Math.max(60, size * 3)), now, rng);
    if (chosen.length === 0) return [];
    const sessionItems = focus
      ? items.filter((it) => focus.has(it.key)).map((it) => ({ ...it, due: Math.min(it.due, now) }))
      : items;

    const { words, aiByKey } = await buildWordData(
      lang,
      chosen.map((info) => ({ key: info.key, info })),
      model,
    );

    if (opts.aiSentences) {
      const report = await fillWithAI(lang, words, aiByKey, size);
      opts.onAISentences?.(report);
    }

    const skills = opts.skills;
    // New items: normally at most 40% of a session, but when few reviews are due (e.g. the first
    // sessions) let new items fill the rest, so the session has the length the learner chose.
    const due = sessionItems.filter((it) => it.due <= now).length;
    const newItems = focus ? size : Math.max(Math.ceil(size * 0.4), size - due);
    const exercises = buildSession(
      words,
      sessionItems,
      { size, newItems, now, ...(skills ? { skills } : {}) },
      rng,
    );
    return padWordChoices(exercises, words, lang);
  }

  /**
   * "Fill gaps with AI sentences": words near the front of the session with fewer than
   * AI_GOOD_SENTENCES usable sentences and no earlier AI attempt get validated AI sentences
   * (at most AI_WORDS_PER_SESSION words). They go after Anki and text sentences, before Tatoeba.
   */
  async function fillWithAI(
    lang: string,
    words: WordData[],
    aiByKey: Map<string, GeneratedSentenceSet>,
    size: number,
  ): Promise<AISentenceReport> {
    const reused = words.filter((w) => w.sentences.some((x) => x.source === "ai")).length;
    const report: AISentenceReport = { requested: 0, accepted: 0, rejected: 0, reused };
    if (!deps.aiSentences?.ready()) return report;
    const needy = words
      .slice(0, Math.max(size, 20))
      .filter(
        (w) =>
          !aiByKey.has(w.key) &&
          !/\s/.test(w.key) &&
          goodSentences(w.sentences) < AI_GOOD_SENTENCES,
      )
      .slice(0, AI_WORDS_PER_SESSION);
    if (needy.length === 0) return report;
    const fill = await deps.aiSentences.fill(
      lang,
      needy.map((w) => ({ key: w.key, lemma: w.lemma, existing: w.sentences.map((x) => x.text) })),
      needy.map((w) => w.key),
    );
    needy.forEach((w, k) => {
      const add = (fill.sentences[k] ?? []).flatMap(aiExample);
      if (!add.length) return;
      const tatoeba = w.sentences.filter((x) => x.source === "tatoeba");
      w.sentences = [...w.sentences.filter((x) => x.source !== "tatoeba"), ...add, ...tatoeba];
    });
    return {
      ...report,
      requested: fill.requested,
      accepted: fill.accepted,
      rejected: fill.rejected,
      ...(fill.error ? { error: fill.error } : {}),
    };
  }

  /**
   * Give word-choice exercises with few options extra distractors from the server's similar
   * words. A similar word is only used when its dictionary meanings are known and share nothing
   * with the answer's (otherwise "woning" next to "huis" would be a second correct answer).
   */
  async function padWordChoices(
    exercises: Exercise[],
    words: WordData[],
    lang: string,
  ): Promise<Exercise[]> {
    const thin = exercises.filter((e) => e.kind === "word-choice" && (e.choices?.length ?? 0) < 4);
    if (thin.length === 0) return exercises;
    const byKey = new Map(words.map((w) => [w.key, w]));
    const items = thin.flatMap((e) => {
      const w = byKey.get(e.key);
      return w ? [{ lemma: w.lemma, pos: w.pos }] : [];
    });
    const similar = await deps.data.similar(lang, items, 4);
    const candidates = [...new Set(Object.values(similar).flat())];
    if (candidates.length === 0) return exercises;
    const dict = await deps.dictionary(candidates);
    const glossesOf = (lemma: string, pos: string): string[] => {
      const entries = dict[lemma];
      return entries?.length ? deps.composeGlosses(null, entries, pos).glosses : [];
    };
    return exercises.map((e) => {
      if (!thin.includes(e)) return e;
      const target = byKey.get(e.key);
      if (!target) return e;
      const extra = (similar[target.lemma] ?? []).filter((s) => {
        if (s === e.answer || e.choices?.includes(s)) return false;
        const glosses = glossesOf(s, target.pos);
        return glosses.length > 0 && !sharesMeaning(target.glosses, glosses);
      });
      const choices = [...(e.choices ?? []), ...extra].slice(0, 4);
      return choices.length > (e.choices?.length ?? 0) ? { ...e, choices } : e;
    });
  }

  /**
   * A session for one grammar topic: the topic's exercise kinds, built only from sentences in
   * which the topic was detected (the learner's texts first, then Tatoeba).
   */
  async function startTopicPractice(opts: TopicPracticeOptions): Promise<Exercise[]> {
    if (!deps.topicMaterial || opts.detects.length === 0) return [];
    const lang = await deps.lang();
    const material = await deps.topicMaterial(opts.detects);
    if (opts.topicId) await addTopicAI(lang, opts, material);
    const needWords = opts.kinds.some((k) => k !== "scramble");
    const byKey = new Map<
      string,
      { lemma: string; pos: string; zipf: number; sentences: ExampleSentence[] }
    >();
    if (needWords) {
      for (const w of material.words) {
        const cur = byKey.get(w.key);
        if (cur) {
          if (!cur.sentences.some((s) => s.text === w.sentence.text))
            cur.sentences.push(w.sentence);
        } else if (byKey.size < TOPIC_WORDS) {
          byKey.set(w.key, { lemma: w.lemma, pos: w.pos, zipf: w.zipf, sentences: [w.sentence] });
        }
      }
    }
    const entries = [...byKey.entries()];
    const none = <T>(): Record<string, T> => ({});
    const [dict, forms, infos] = await Promise.all([
      entries.length
        ? deps.dictionary([...new Set(entries.map(([, w]) => w.lemma))])
        : none<DictEntries>(),
      entries.length
        ? deps.data.forms(
            lang,
            entries
              .filter(([, w]) => FORM_POS.has(w.pos))
              .map(([, w]) => ({ lemma: w.lemma, pos: w.pos })),
          )
        : none<WordForms>(),
      repo.wordsByKeys(
        lang,
        entries.map(([key]) => key),
      ),
    ]);
    const infoByKey = new Map(infos.map((w) => [w.key, w]));
    const words: WordData[] = entries.map(([key, w]) => {
      const info = infoByKey.get(key) ?? null;
      const { glosses, article } = deps.composeGlosses(info, dict[w.lemma], w.pos);
      const word: WordData = {
        key,
        lemma: w.lemma,
        pos: w.pos,
        glosses,
        zipf: w.zipf,
        state: info?.state ?? "unknown",
        pKnown: info?.pKnown ?? 0,
        sentences: w.sentences,
      };
      if (w.pos === "NOUN" && (article === "de" || article === "het")) word.article = article;
      const f = forms[w.lemma];
      if (f) word.forms = f;
      return word;
    });
    return buildTopicSession(
      { kinds: opts.kinds, sentences: material.sentences, words, size: opts.size ?? 10 },
      createRng(clock()),
    );
  }

  /** Earlier AI sentences of the topic, and new ones when the topic has few hits (scramble kinds). */
  async function addTopicAI(
    lang: string,
    opts: TopicPracticeOptions,
    material: TopicMaterial,
  ): Promise<void> {
    const sets = (await repo.generatedSentences(lang)).filter((x) => x.topic === opts.topicId);
    const have = new Set(material.sentences.map((x) => x.text));
    const add = (gs: GeneratedSentence[]) => {
      for (const t of gs.flatMap(aiTopicSentence)) {
        if (!have.has(t.text)) {
          have.add(t.text);
          material.sentences.push(t);
        }
      }
    };
    for (const set of sets) add(set.sentences);
    if (!opts.aiSentences) return;
    const report: AISentenceReport = {
      requested: 0,
      accepted: 0,
      rejected: 0,
      reused: sets.reduce((n, x) => n + x.sentences.length, 0),
    };
    if (
      sets.length === 0 &&
      material.sentences.length < AI_TOPIC_FEW &&
      deps.aiSentences?.ready()
    ) {
      const fill = await deps.aiSentences.fill(
        lang,
        [{ key: "", topicId: opts.topicId!, existing: [...have] }],
        [],
      );
      add(fill.sentences[0] ?? []);
      Object.assign(report, {
        requested: fill.requested,
        accepted: fill.accepted,
        rejected: fill.rejected,
        ...(fill.error ? { error: fill.error } : {}),
      });
    }
    opts.onAISentences?.(report);
  }

  async function answerExercise(exercise: Exercise, attempt: AttemptInput): Promise<AnswerResult> {
    const lang = await deps.lang();
    const checked = checkAnswer(exercise, attempt.answer);
    const full = { ...attempt, correct: checked.correct };
    const grade = gradeAttempt(exercise, full);
    const now = clock();
    if (!itemCache.has(lang)) await loadItems(lang);
    const prev = itemCache.get(lang)!.get(itemId(exercise.key, exercise.skill));
    const next = review(prev, exercise.key, exercise.skill, grade, now);
    await repo.append({
      type: "ExerciseAnswered",
      lang,
      key: exercise.key,
      skill: exercise.skill,
      kind: exercise.kind,
      grade,
      correct: checked.correct,
      ms: Math.max(0, Math.round(attempt.ms)),
      at: now,
      state: next,
    });
    itemCache.get(lang)!.set(itemId(exercise.key, exercise.skill), next);
    // The app's own cards: building and typing also answer the word's due card; the choice
    // exercises don't, because picking the meaning is the card's own job (algorithms.md 4.7.5).
    if (STEP_OF[exercise.kind] >= 3)
      await deps
        .evidence?.()
        .exercise(exercise.key, grade, attempt.ms)
        .catch((e: unknown) => console.warn("Could not update the card:", e));
    return {
      grade,
      correct: checked.correct,
      ...(checked.note ? { note: checked.note } : {}),
      next,
    };
  }

  return {
    practiceOverview,
    startPractice,
    startTopicPractice,
    answerExercise,
    comeBack,
    lessonSources,
    buildWordData,
    /** Forget the cached practice items (another device answered). */
    invalidate: () => itemCache.clear(),
  };
}
