/**
 * Practice services on top of the local database: builds sessions from the learner model,
 * Anki sentences, the learner's own texts and the NLP server, grades answers with the engine
 * and records them as ExerciseAnswered events. Nothing here writes to Anki (ADR 0003).
 */
import {
  type AnalyzedToken,
  type Exercise,
  type ExampleSentence,
  type ItemState,
  type LearnerModel,
  type Skill,
  type WordData,
  matchToken,
  normalizeKey,
} from "@app/core";
import type { KenningRepository, WordInfo } from "@app/db";
import type { GlossEntry } from "@app/nlp-client";
import {
  buildSession,
  checkAnswer,
  createRng,
  gradeAttempt,
  practiceStats,
  review,
} from "../practice/engine.js";
import type { PracticeData } from "./practiceData.js";
import type { AnswerResult, AttemptInput, PracticeOverview } from "./types.js";

type DictEntries = GlossEntry[];

export interface LivePracticeDeps {
  repo: KenningRepository;
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
  now?: () => number;
}

const DEFAULT_SIZE = 20;
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

/** What the texts tell about a word: lemma, part of speech, frequency, usable sentences. */
interface Occurrence {
  lemma: string;
  pos: string;
  zipf: number;
  sentences: ExampleSentence[];
}

/** Find [start, end) of `lemma` (or an inflection sharing its stem) in `sentence`. */
export function locateWord(sentence: string, lemma: string): [number, number] | null {
  const lower = sentence.toLowerCase();
  const target = lemma.toLowerCase();
  const stem = target.slice(0, Math.max(3, target.length - 2));
  let loose: [number, number] | null = null;
  for (const m of lower.matchAll(/\p{L}+/gu)) {
    const range: [number, number] = [m.index, m.index + m[0].length];
    if (m[0] === target) return range;
    if (!loose && m[0].startsWith(stem)) loose = range;
  }
  return loose;
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
  for (const t of tokens) {
    if (!t.is_word || t.particle_of !== null) continue;
    const key = matchToken(t, model) ?? normalizeKey(t.lemma);
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
  const { repo } = deps;
  const clock = deps.now ?? Date.now;

  async function practiceOverview(): Promise<PracticeOverview> {
    const lang = await deps.lang();
    const now = clock();
    const [items, learning, log] = await Promise.all([
      repo.practiceItems(lang),
      repo.words(lang, { state: "learning" }),
      repo.practiceLog(lang, 1),
    ]);
    const stats = practiceStats(items, now);
    const practised = new Set(items.map((i) => i.key));
    return {
      due: stats.due,
      learned: stats.learned,
      bySkill: stats.bySkill,
      newAvailable: learning.filter((w) => !practised.has(w.key)).length,
      lastSession: log[0]?.at ?? null,
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
    const eligible = new Map(
      infos.filter((w) => w.state === "learning" || w.state === "known").map((w) => [w.key, w]),
    );
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
      ...learning.filter((w) => !practised.has(w.key)),
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
    for (const summary of texts) {
      const text = await repo.getText(summary.id);
      if (text?.tokens) sentencesFromTexts(text.tokens, text.content, model, keys, out);
    }
    return out;
  }

  async function startPractice(
    opts: { size?: number; skills?: Skill[] } = {},
  ): Promise<Exercise[]> {
    const lang = await deps.lang();
    const now = clock();
    const size = Math.max(1, opts.size ?? DEFAULT_SIZE);
    const rng = createRng(now);
    const [infos, items, model] = await Promise.all([
      repo.words(lang),
      repo.practiceItems(lang),
      deps.model(),
    ]);
    const chosen = chooseWords(
      infos,
      items,
      opts.skills,
      Math.min(120, Math.max(60, size * 3)),
      now,
      rng,
    );
    if (chosen.length === 0) return [];

    const occ = await occurrences(new Set(chosen.map((w) => w.key)), model);
    const dict = await deps.dictionary([
      ...new Set(chosen.map((w) => occ.get(w.key)?.lemma ?? w.key)),
    ]);

    const base = chosen.map((info) => {
      const o = occ.get(info.key);
      const lemma = o?.lemma ?? info.key;
      const entries = dict[lemma];
      const pos = o?.pos ?? UPOS[entries?.[0]?.pos ?? ""] ?? "X";
      const { glosses, article } = deps.composeGlosses(info, entries, pos);
      return { info, lemma, pos, glosses, article, o };
    });

    const [forms, serverSentences] = await Promise.all([
      deps.data.forms(
        lang,
        base.filter((b) => FORM_POS.has(b.pos)).map((b) => ({ lemma: b.lemma, pos: b.pos })),
      ),
      deps.data.sentences(
        lang,
        base.filter((b) => (b.o?.sentences.length ?? 0) < 2).map((b) => b.lemma),
        { limit: 2, maxWords: 14 },
      ),
    ]);

    const words: WordData[] = base.map(({ info, lemma, pos, glosses, article, o }) => {
      const sentences: ExampleSentence[] = [];
      if (info.sentence) {
        const target = locateWord(info.sentence, lemma);
        if (target) {
          sentences.push({
            text: info.sentence,
            target,
            source: "anki",
            ...(info.sentenceTranslation ? { translation: info.sentenceTranslation } : {}),
          });
        }
      }
      sentences.push(...(o?.sentences ?? []), ...(serverSentences[lemma] ?? []));
      const word: WordData = {
        key: info.key,
        lemma,
        pos,
        glosses,
        zipf: o?.zipf ?? 0,
        state: info.state,
        pKnown: info.pKnown,
        sentences,
      };
      if (article && pos === "NOUN" && (article === "de" || article === "het"))
        word.article = article;
      const f = forms[lemma];
      if (f) word.forms = f;
      return word;
    });

    const skills = opts.skills;
    const exercises = buildSession(
      words,
      items,
      { size, newItems: Math.min(8, Math.ceil(size * 0.4)), now, ...(skills ? { skills } : {}) },
      rng,
    );
    return padWordChoices(exercises, words, lang);
  }

  /** Give word-choice exercises with few options extra distractors from the server's similar words. */
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
    return exercises.map((e) => {
      if (!thin.includes(e)) return e;
      const lemma = byKey.get(e.key)?.lemma;
      const extra = (lemma ? (similar[lemma] ?? []) : []).filter(
        (s) => s !== e.answer && !e.choices?.includes(s),
      );
      const choices = [...(e.choices ?? []), ...extra].slice(0, 4);
      return choices.length > (e.choices?.length ?? 0) ? { ...e, choices } : e;
    });
  }

  async function answerExercise(exercise: Exercise, attempt: AttemptInput): Promise<AnswerResult> {
    const lang = await deps.lang();
    const checked = checkAnswer(exercise, attempt.answer);
    const full = { ...attempt, correct: checked.correct };
    const grade = gradeAttempt(exercise, full);
    const now = clock();
    const prev = (await repo.practiceItems(lang)).find(
      (i) => i.key === exercise.key && i.skill === exercise.skill,
    );
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
    return {
      grade,
      correct: checked.correct,
      ...(checked.note ? { note: checked.note } : {}),
      next,
    };
  }

  return { practiceOverview, startPractice, answerExercise };
}
