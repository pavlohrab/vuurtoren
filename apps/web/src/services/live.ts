/**
 * Real services: local database (@app/db), planner (@app/core), NLP service (@app/nlp-client)
 * and AnkiConnect (@app/anki). The UI only sees the AppServices interface.
 */
import {
  AnkiConnectClient,
  probeAnki,
  requestAnkiPermission,
  type AnkiConnectionState,
  addWordToAnki,
  cardStatus,
  highlightSentence,
  learnNext,
  markKnownInAnki,
  type NoteCardStatus,
} from "@app/anki";
import {
  type AnalyzedToken,
  DEFAULT_PLANNER,
  type LearnerModel,
  type PlannerOptions,
  type SegmentPlan,
  type StaircaseState,
  type TokenLabel,
  type WordState,
  classifyTokens,
  estimateVocabulary,
  matchToken,
  normalizeKey,
  planText,
  summarizeModel,
  textDifficulty,
  updateStaircase,
} from "@app/core";
import {
  type KenningRepository,
  type StoredText,
  type WordInfo,
  contentHash,
  createUlidGenerator,
} from "@app/db";
import { absentAnki, ankiFromStatus, unavailableAnki } from "./ankiState.js";
import { NlpClient } from "@app/nlp-client";
import { createLiveCourses } from "./liveCourses.js";
import { createLiveAI } from "./liveAI.js";
import { createLiveProfile } from "./liveProfile.js";
import type { AddOptions } from "./profileTypes.js";
import { createLiveGrammar } from "./liveGrammar.js";
import { createLivePractice } from "./livePractice.js";
import { createPracticeData } from "./practiceData.js";
import type {
  AnkiConnectResult,
  AnkiStatus,
  AppServices,
  ImportInput,
  InspectorEntry,
  LearnerSummary,
  ReadingView,
  Settings,
  TextListItem,
  TextWordItem,
} from "./types.js";

/** How long opening a word waits for Anki before showing "Anki not reachable". */
const INSPECT_TIMEOUT_MS = 3000;
/** The review asks for many notes at once, so it waits a little longer than one word does. */
const REVIEW_TIMEOUT_MS = 5000;
const ANKI_KEY_STORAGE = "kenning.ankiKey";
function readSecret(name: string): string | undefined {
  try {
    return localStorage.getItem(name) ?? undefined;
  } catch {
    return undefined;
  }
}
function writeSecret(name: string, value: string): void {
  try {
    if (value) localStorage.setItem(name, value);
    else localStorage.removeItem(name);
  } catch {
    // storage unavailable (private mode): the key lasts for this session only
  }
}

export const DEFAULT_SETTINGS: Settings = {
  // Dev server proxies /anki and /nlp (vite.config.ts); nginx proxies /nlp in production.
  ankiUrl: import.meta.env.DEV ? "/anki" : "http://127.0.0.1:8765",
  nlpUrl: (import.meta.env["VITE_NLP_URL"] as string | undefined) ?? "/nlp",
  lang: "nl",
  targetDeck: "Kenning::Nederlands",
  theme: "system",
  help: 0.25,
  newWords: "auto",
  glossClozes: false,
  grammarSpotlights: false,
};

// spaCy universal POS -> Wiktionary (kaikki) part of speech, to pick the sense that fits.
const KAIKKI_POS: Record<string, string[]> = {
  NOUN: ["noun"],
  PROPN: ["name", "noun"],
  VERB: ["verb"],
  AUX: ["verb"],
  ADJ: ["adj"],
  ADV: ["adv"],
  PRON: ["pron"],
  DET: ["det", "article", "pron"],
  ADP: ["prep", "postp"],
  NUM: ["num"],
  CCONJ: ["conj"],
  SCONJ: ["conj"],
  INTJ: ["intj"],
};

/** Max words per /gloss request (server limit 2000). */
const GLOSS_BATCH = 500;

/** Dictionary entries with senses of the token's part of speech first. */
function orderByPos<T extends { pos: string }>(entries: T[], pos?: string): T[] {
  const wanted = pos ? (KAIKKI_POS[pos] ?? []) : [];
  return [
    ...entries.filter((e) => wanted.includes(e.pos)),
    ...entries.filter((e) => !wanted.includes(e.pos)),
  ];
}

// Wiktionary form-of senses ("inflection of fietsen: …", "plural of …") are noise as glosses.
const FORM_OF =
  /^(inflection|plural|diminutive|singular|past|present|feminine|comparative|superlative)[^:]* of /i;

const DEFAULT_STAIRCASE: StaircaseState = {
  targetCoverage: DEFAULT_PLANNER.targetCoverage,
  newWordBudget: DEFAULT_PLANNER.newWordBudget,
};

/** Max characters per /analyze/text request (server limit is higher; keeps requests snappy). */
const CHUNK_CHARS = 40_000;

/** Split at paragraph (or line) boundaries into chunks of at most `max` chars. */
export function chunkText(text: string, max = CHUNK_CHARS): { start: number; text: string }[] {
  const chunks: { start: number; text: string }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + max);
    if (end < text.length) {
      const para = text.lastIndexOf("\n\n", end);
      const line = text.lastIndexOf("\n", end);
      const space = text.lastIndexOf(" ", end);
      end = para > start ? para + 2 : line > start ? line + 1 : space > start ? space + 1 : end;
    }
    chunks.push({ start, text: text.slice(start, end) });
    start = end;
  }
  return chunks;
}

/** Re-base chunk analyses into one token list for the whole text. */
export function mergeChunkTokens(
  chunks: { start: number; tokens: AnalyzedToken[] }[],
): AnalyzedToken[] {
  const out: AnalyzedToken[] = [];
  let sentBase = 0;
  for (const { start, tokens } of chunks) {
    const base = out.length;
    let maxSent = -1;
    for (const t of tokens) {
      maxSent = Math.max(maxSent, t.sent);
      out.push({
        ...t,
        i: t.i + base,
        head: t.head + base,
        particle_of: t.particle_of === null ? null : t.particle_of + base,
        sent: t.sent + sentBase,
        start: t.start + start,
        end: t.end + start,
      });
    }
    sentBase += maxSent + 1;
  }
  return out;
}

function titleFrom(content: string): string {
  const first = content.trim().split(/\n/)[0] ?? "";
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()}…` : first || "Untitled";
}

type Dictionary = Awaited<ReturnType<NlpClient["gloss"]>>;

/** Character range [start, end) of every sentence, by sentence number. */
function sentenceSpans(tokens: AnalyzedToken[]): Map<number, [number, number]> {
  const spans = new Map<number, [number, number]>();
  for (const t of tokens) {
    const s = spans.get(t.sent);
    if (s) s[1] = t.end;
    else spans.set(t.sent, [t.start, t.end]);
  }
  return spans;
}

/** Meanings of a word: the card's gloss first, then dictionary senses (form-of noise removed). */
function composeGlosses(
  info: WordInfo | null,
  entries: Dictionary[string] | undefined,
  pos: string,
): { glosses: string[]; article: string | undefined } {
  const glosses: string[] = [];
  if (info?.gloss) glosses.push(info.gloss);
  const ordered = orderByPos(entries ?? [], pos);
  for (const e of ordered)
    for (const g of e.glosses)
      if (!FORM_OF.test(g) && !PLACE_SENSE.test(g) && !glosses.includes(g)) glosses.push(g);
  const article =
    info?.article ??
    ordered.find((e) => e.article === "de" || e.article === "het")?.article ??
    undefined;
  return { glosses: glosses.slice(0, 6), article };
}

/** Text ids: ULIDs (`crypto.randomUUID` does not exist in insecure http contexts). */
const nextUlid = createUlidGenerator();

/**
 * Wiktionary place-name senses ("a hamlet in Weststellingwerf, Friesland, Netherlands") are
 * noise for a learner looking up a common noun; proper nouns are not glossed this way anyway.
 */
const PLACE_SENSE =
  /^an? (hamlet|village|town|city|neighbourhood|neighborhood|municipality|river|surname|placename|place)\b.*\b(in|of)\b/i;

/** Where a word may enter the review, strongest reason first. */
const SOURCE_RANK = { introduce: 0, lookup: 1, gloss: 2 } as const;

/** Map the client's connection state to what the Settings screen shows. */
export function toAnkiStatus(c: AnkiConnectionState): AnkiStatus {
  switch (c.state) {
    case "connected":
      return { connected: true, state: "connected", version: c.version };
    case "needs-key":
      return {
        connected: false,
        state: "needs-key",
        version: c.version,
        error: "Anki allows this site but wants an API key. Enter it above.",
      };
    case "not-allowed":
      return {
        connected: false,
        state: "not-allowed",
        error: "Anki does not allow this site yet.",
      };
    case "busy":
      return {
        connected: false,
        state: "busy",
        error: "Anki did not answer in time. Is a dialog open in Anki?",
      };
    default:
      return {
        connected: false,
        state: "not-running",
        error: "Cannot reach Anki. Is Anki running with the AnkiConnect add-on installed?",
      };
  }
}

export function createLiveServices(repo: KenningRepository): AppServices {
  let settingsCache: Settings | null = null;
  // Bumped whenever the learner model changes, so cached plans are recomputed.
  let modelVersion = 0;
  let modelCache: { version: number; lang: string; model: LearnerModel } | null = null;
  const planCache = new Map<string, { version: number; hash: string; view: ReadingView }>();
  // Translation per lemma key: Anki gloss first, then the Wiktionary dictionary; null = none.
  const glossCache = new Map<string, string | null>();
  const translationCache = new Map<string, string>();
  const inFlight = new Map<string, Promise<ReadingView | null>>();

  /** Translations for (key, lemma) pairs, batched: one dictionary request for all misses. */
  /**
   * Translations for (key, lemma, pos) items: the Anki card's gloss first, then the Wiktionary
   * dictionary (sense matching the part of speech preferred). `complete` is false when the
   * dictionary could not be reached — callers must not treat missing entries as "no translation".
   */
  async function lookupGlosses(
    items: { key: string; lemma: string; pos?: string }[],
  ): Promise<{ found: Map<string, string>; complete: boolean }> {
    const { lang } = await settings();
    const cacheKey = (it: { key: string; pos?: string }) => `${it.key}|${it.pos ?? ""}`;
    const seen = new Set<string>();
    const missing = items.filter((it) => {
      const k = cacheKey(it);
      if (glossCache.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const needDict: { key: string; lemma: string; pos?: string }[] = [];
    for (const it of missing) {
      const info = await repo.word(lang, it.key);
      if (info?.gloss) glossCache.set(cacheKey(it), info.gloss);
      else needDict.push(it);
    }
    let complete = true;
    if (needDict.length) {
      try {
        const lemmas = [...new Set(needDict.map((it) => it.lemma))];
        const dict: Record<string, { pos: string; glosses: string[] }[]> = {};
        for (let i = 0; i < lemmas.length; i += GLOSS_BATCH) {
          Object.assign(dict, await (await nlp()).gloss("nl", lemmas.slice(i, i + GLOSS_BATCH)));
        }
        for (const it of needDict) {
          const g = orderByPos(dict[it.lemma] ?? [], it.pos)
            .flatMap((e) => e.glosses)
            .find((x) => !FORM_OF.test(x));
          glossCache.set(cacheKey(it), g ?? null);
        }
      } catch (e) {
        // dictionary unavailable (503 when not built, or the server is down): retry next time
        complete = false;
        console.warn("[kenning] dictionary lookup failed:", e);
      }
    }
    const found = new Map<string, string>();
    for (const it of items) {
      const g = glossCache.get(cacheKey(it));
      if (g) found.set(it.key, g);
    }
    return { found, complete };
  }

  async function settings(): Promise<Settings> {
    if (!settingsCache) {
      const saved = await repo.setting<Partial<Settings>>("settings");
      // Older versions stored the key in the event log; ignore it there.
      const rest: Partial<Settings> = { ...saved };
      delete rest.ankiKey;
      settingsCache = { ...DEFAULT_SETTINGS, ...rest };
      const key = readSecret(ANKI_KEY_STORAGE);
      if (key) settingsCache.ankiKey = key;
    }
    return settingsCache;
  }
  const nlp = async () => new NlpClient({ url: (await settings()).nlpUrl });
  const ankiOptions = async (timeoutMs?: number) => {
    const s = await settings();
    return {
      url: s.ankiUrl,
      ...(s.ankiKey ? { apiKey: s.ankiKey } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    };
  };
  const anki = async (timeoutMs?: number) => new AnkiConnectClient(await ankiOptions(timeoutMs));
  /** The add request for a reader word (used by Add to Anki and Mark known). */
  const addRequest = async (entry: InspectorEntry, opts?: AddOptions) => {
    const v = await view(entry.textId);
    const word =
      entry.article && entry.pos === "NOUN" ? `${entry.article} ${entry.lemma}` : entry.lemma;
    return {
      profile: await profile.current(),
      context: { source: "reading" as const, ...(opts?.deck ? { deck: opts.deck } : {}) },
      word,
      key: entry.key,
      sentence: highlightSentence(entry.sentence, ...entry.sentenceHighlight),
      ...(entry.glosses[0] ? { gloss: entry.glosses[0] } : {}),
      ...(entry.sentenceTranslation ? { sentenceTranslation: entry.sentenceTranslation } : {}),
      ...(v ? { source: v.text.title } : {}),
    };
  };
  const record = (e: Parameters<typeof repo.append>[0]) => repo.append(e);
  /** Live Anki state of a word; "unavailable" (with the reason) if Anki cannot answer in time. */
  async function liveAnki(info: WordInfo | null): Promise<InspectorEntry["anki"]> {
    if (!info || info.noteIds.length === 0) return absentAnki(info);
    try {
      const { notes } = await cardStatus(await anki(INSPECT_TIMEOUT_MS), info.noteIds);
      return ankiFromStatus(info, notes);
    } catch (e) {
      return unavailableAnki(info, e instanceof Error ? e.message : String(e));
    }
  }
  /**
   * Live Anki state for many words with ONE request; if Anki cannot answer in time every word is
   * "unavailable" (with the reason), so no action is offered that would fail.
   */
  async function liveAnkiBatch(infos: (WordInfo | null)[]): Promise<InspectorEntry["anki"][]> {
    const ids = [...new Set(infos.flatMap((i) => i?.noteIds ?? []))];
    let notes: NoteCardStatus[] = [];
    try {
      const client = await anki(REVIEW_TIMEOUT_MS);
      // With no notes to ask about, a version call still tells whether Anki is reachable.
      if (ids.length) notes = (await cardStatus(client, ids)).notes;
      else if (infos.length) await client.version();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return infos.map((i) => unavailableAnki(i, reason));
    }
    const byId = new Map(notes.map((n) => [n.noteId, n]));
    return infos.map((info) =>
      info && info.noteIds.length
        ? ankiFromStatus(
            info,
            info.noteIds.flatMap((id) => byId.get(id) ?? []),
          )
        : absentAnki(info),
    );
  }
  /** Sentence translations (offline MT), cached; missing entries when the model is unavailable. */
  async function translateSentences(sentences: string[]): Promise<Map<string, string>> {
    const todo = [...new Set(sentences.filter((s) => s.trim() && !translationCache.has(s)))];
    if (todo.length) {
      try {
        const res = await (await nlp()).translate(todo, { source: "nl", target: "en" });
        for (const r of res) translationCache.set(r.text, r.translation);
      } catch (e) {
        // optional: model not fetched (503) or server down
        console.warn("[kenning] sentence translation unavailable:", e);
      }
    }
    const out = new Map<string, string>();
    for (const s of sentences) {
      const t = translationCache.get(s);
      if (t) out.set(s, t);
    }
    return out;
  }
  /** Dictionary entries for lemmas in one request; empty when the dictionary is unavailable. */
  async function dictionaryFor(lemmas: string[]): Promise<Dictionary> {
    if (lemmas.length === 0) return {};
    try {
      return await (await nlp()).gloss("nl", lemmas);
    } catch {
      return {}; // dictionary optional (503 when not built)
    }
  }
  /** The inspector entry of one word occurrence; shared by `inspect` and `textWords`. */
  function describeWord(
    v: ReadingView,
    t: AnalyzedToken,
    spans: Map<number, [number, number]>,
    w: {
      key: string;
      info: WordInfo | null;
      label: InspectorEntry["label"];
      dict: Dictionary;
      anki: InspectorEntry["anki"];
    },
  ): InspectorEntry {
    const [s0, s1] = spans.get(t.sent) ?? [t.start, t.end];
    const { glosses, article } = composeGlosses(w.info, w.dict[t.lemma], t.pos);
    const entry: InspectorEntry = {
      textId: v.text.id,
      tokenIndex: t.i,
      surface: t.text,
      lemma: t.lemma,
      key: w.key,
      label: w.label,
      state: w.info?.state ?? "unknown",
      pKnown: w.info?.pKnown ?? 0,
      pos: t.pos,
      glosses,
      decks: w.info?.decks ?? [],
      inAnki: w.info?.source === "anki" || w.info?.addedNoteId !== undefined,
      anki: w.anki,
      sentence: v.text.content.slice(s0, s1),
      sentenceHighlight: [t.start - s0, t.end - s0],
    };
    if (article) entry.article = article;
    return entry;
  }
  const changed = () => {
    modelVersion++;
  };

  async function model(): Promise<LearnerModel> {
    const { lang } = await settings();
    if (!modelCache || modelCache.version !== modelVersion || modelCache.lang !== lang) {
      modelCache = { version: modelVersion, lang, model: await repo.learnerModel(lang) };
    }
    return modelCache.model;
  }

  async function plannerOptions(m: LearnerModel): Promise<PlannerOptions> {
    const s = await settings();
    const st = (await repo.staircase(s.lang)) ?? DEFAULT_STAIRCASE;
    return {
      ...DEFAULT_PLANNER,
      targetCoverage: st.targetCoverage,
      newWordBudget: s.newWords === "auto" ? st.newWordBudget : s.newWords,
      vocabEstimate: estimateVocabulary(m),
    };
  }

  async function analyze(text: StoredText): Promise<AnalyzedToken[]> {
    const client = await nlp();
    const chunks = chunkText(text.content);
    const analyses = await client.analyzeText(
      "nl",
      chunks.map((c) => c.text),
    );
    const tokens = mergeChunkTokens(
      chunks.map((c, k) => ({ start: c.start, tokens: analyses[k]!.tokens as AnalyzedToken[] })),
    );
    await repo.append({
      type: "TextAnalyzed",
      textId: text.id,
      contentHash: contentHash(text.content),
      tokens,
    });
    return tokens;
  }

  /** Concurrent callers for the same text share one computation (and one analysis). */
  function view(textId: string): Promise<ReadingView | null> {
    const running = inFlight.get(textId);
    if (running) return running;
    const p = computeView(textId).finally(() => inFlight.delete(textId));
    inFlight.set(textId, p);
    return p;
  }

  async function computeView(textId: string): Promise<ReadingView | null> {
    const text = await repo.getText(textId);
    if (!text) return null;
    const hash = contentHash(text.content);
    const cached = planCache.get(textId);
    if (cached && cached.version === modelVersion && cached.hash === hash) return cached.view;
    const tokens = text.tokens ?? (await analyze(text));
    const m = await model();
    const opts = await plannerOptions(m);
    const plans: SegmentPlan[] = planText(tokens, m, opts, text.content);
    const cacheable = await dropUnhintableClozes(tokens, plans, m);
    const staircase = { targetCoverage: opts.targetCoverage, newWordBudget: opts.newWordBudget };
    const v: ReadingView = { text: { ...text, tokens }, tokens, plans, staircase };
    if (cacheable) planCache.set(textId, { version: modelVersion, hash, view: v });
    return v;
  }

  /**
   * A cloze needs a meaning hint to be fair (one sentence often fits several words), so clozes
   * whose word has no translation are turned back into normal words.
   */
  async function dropUnhintableClozes(
    tokens: AnalyzedToken[],
    plans: SegmentPlan[],
    m: LearnerModel,
  ): Promise<boolean> {
    const clozeTokens = plans.flatMap((p) => p.clozes).map((i) => tokens[i]!);
    if (!clozeTokens.length) return true;
    const keyOf = (t: AnalyzedToken) => matchToken(t, m) ?? normalizeKey(t.lemma);
    const { found, complete } = await lookupGlosses(
      clozeTokens.map((t) => ({ key: keyOf(t), lemma: t.lemma, pos: t.pos })),
    );
    // Dictionary unreachable: keep the clozes rather than silently removing them all.
    if (!complete) return false;
    const base = classifyTokens(tokens, m);
    for (const plan of plans) {
      const drop = new Set(plan.clozes.filter((i) => !found.has(keyOf(tokens[i]!))));
      if (!drop.size) continue;
      plan.clozes = plan.clozes.filter((i) => !drop.has(i));
      for (const p of plan.tokens) if (drop.has(p.i)) p.label = base[p.i]?.label ?? "known";
    }
    return true;
  }

  async function summary(): Promise<LearnerSummary> {
    const { lang } = await settings();
    const m = await model();
    const counts = summarizeModel(m);
    const snap = await repo.lastSnapshot(lang);
    return {
      known: counts.known,
      learning: counts.learning,
      // "Seen" words have been met in a text, so they are not part of "not yet met".
      unknown: counts.unknown,
      vocabEstimate: estimateVocabulary(m),
      lastSync: snap?.at ?? null,
      sources: snap?.sources ?? [],
    };
  }

  const grammar = createLiveGrammar({
    repo,
    nlp,
    view,
    model,
    chunkText,
    translate: translateSentences,
  });

  const practice = createLivePractice({
    repo,
    lang: async () => (await settings()).lang,
    model,
    dictionary: dictionaryFor,
    composeGlosses,
    data: createPracticeData(async () => (await settings()).nlpUrl),
    topicMaterial: grammar.topicMaterial,
  });

  const profile = createLiveProfile({ repo, settings, anki, nlp, changed });

  const ai = createLiveAI({
    repo,
    settings,
    profile: profile.current,
    model,
    vocabEstimate: async () => (await summary()).vocabEstimate,
    anki: () => anki(),
    glossLemmas: async (lemmas) =>
      Object.fromEntries((await lookupGlosses(lemmas.map((l) => ({ key: l, lemma: l })))).found),
    changed,
  });

  const courses = createLiveCourses({
    repo,
    settings,
    profile: profile.current,
    nlp,
    anki,
    model,
    dictionary: dictionaryFor,
    composeGlosses,
    data: createPracticeData(async () => (await settings()).nlpUrl),
    importText: (input) => services.importText(input),
    changed,
  });

  const services: AppServices = {
    ...profile.services,
    ...practice,
    ...ai,
    ...courses,
    textGrammar: grammar.textGrammar,
    grammarOverview: grammar.grammarOverview,
    grammarExamples: grammar.grammarExamples,
    async listTexts(): Promise<TextListItem[]> {
      const texts = await repo.listTexts();
      const out: TextListItem[] = [];
      for (const t of texts) {
        let coverage: number | null = null;
        let newTypes: number | null = null;
        if (t.analyzed) {
          const v = await view(t.id);
          if (v) {
            const d = textDifficulty(v.plans);
            coverage = d.coverage;
            newTypes = d.newTypes;
          }
        }
        out.push({ ...t, coverage, newTypes });
      }
      return out;
    },

    getReading: view,

    async importText(input: ImportInput, onProgress?: (msg: string) => void): Promise<string> {
      const client = await nlp();
      let title: string;
      let content: string;
      let ref: string | undefined;
      if (input.kind === "paste") {
        content = input.content;
        title = input.title?.trim() || titleFrom(content);
        ref = input.ref;
      } else if (input.kind === "url") {
        onProgress?.("Fetching the page…");
        const page = await client.extractUrl(input.url);
        content = page.text;
        title = page.title || titleFrom(content);
        ref = page.url;
      } else if (input.kind === "pdf") {
        onProgress?.("Reading the PDF…");
        const pdf = await client.extractPdf(input.file, input.file.name);
        if (pdf.needs_ocr) {
          onProgress?.("The PDF has no text layer — running OCR (this can take a while)…");
          content = (await client.ocr(input.file, "nl", input.file.name)).text;
        } else content = pdf.text;
        title = input.title?.trim() || pdf.title || input.file.name.replace(/\.pdf$/i, "");
        ref = input.file.name;
      } else {
        onProgress?.("Recognising text in the photo…");
        content = (await client.ocr(input.file, "nl", input.file.name)).text;
        title = input.title?.trim() || titleFrom(content);
        ref = input.file.name;
      }
      // Normalise line endings so paragraph detection ("\n\n") works for Windows text too.
      content = content.replace(/\r\n?/g, "\n");
      if (!content.trim()) throw new Error("No text found to import.");
      const textId = nextUlid();
      await repo.append({
        type: "TextImported",
        textId,
        title,
        lang: (await settings()).lang,
        source: ref === undefined ? { kind: input.kind } : { kind: input.kind, ref },
        content,
      });
      onProgress?.("Analysing the text…");
      const stored = await repo.getText(textId);
      try {
        if (stored) await analyze(stored);
      } catch (e) {
        // Don't leave a half-imported text behind (a retry would create a duplicate).
        await repo.append({ type: "TextDeleted", textId });
        throw e;
      }
      return textId;
    },

    async deleteText(textId: string): Promise<void> {
      await repo.append({ type: "TextDeleted", textId });
      planCache.delete(textId);
    },

    async inspect(textId: string, tokenIndex: number): Promise<InspectorEntry> {
      const v = await view(textId);
      if (!v) throw new Error("Text not found");
      const clicked = v.tokens[tokenIndex];
      if (!clicked) throw new Error("Token not found");
      // A detached particle ("op" in "Ik bel je op") stands for its verb.
      const t = clicked.particle_of !== null ? (v.tokens[clicked.particle_of] ?? clicked) : clicked;
      const { lang } = await settings();
      const m = await model();
      const key = matchToken(t, m) ?? normalizeKey(t.lemma);
      const info = await repo.word(lang, key);
      const planned = v.plans.flatMap((p) => p.tokens).find((p) => p.i === t.i);
      const [dict, anki] = await Promise.all([dictionaryFor([t.lemma]), liveAnki(info)]);
      const entry = describeWord(v, t, sentenceSpans(v.tokens), {
        key,
        info,
        label: planned?.label ?? "new",
        dict,
        anki,
      });
      const tr = (await translateSentences([entry.sentence])).get(entry.sentence);
      if (tr) entry.sentenceTranslation = tr;
      return entry;
    },

    async textWords(textId, opts = {}): Promise<TextWordItem[]> {
      const v = await view(textId);
      if (!v) throw new Error("Text not found");
      const { lang } = await settings();
      const looked = new Set(await repo.lookedUpKeys(lang, textId));
      // Union in text order: first qualifying occurrence of each key, strongest source wins.
      const picked = new Map<
        string,
        { t: AnalyzedToken; label: TokenLabel; source: TextWordItem["source"] }
      >();
      for (const p of v.plans.flatMap((plan) => plan.tokens)) {
        const t = v.tokens[p.i];
        if (!t || !p.key || p.label === "nonword" || p.label === "ignored") continue;
        // A detached particle stands for its verb, which has its own token.
        if (t.particle_of !== null) continue;
        const source: TextWordItem["source"] | null =
          p.label === "introduce"
            ? "introduce"
            : p.label === "gloss" && opts.includeGlossed
              ? "gloss"
              : looked.has(p.key) && p.label !== "known"
                ? "lookup"
                : null;
        if (!source) continue;
        const have = picked.get(p.key);
        if (!have) picked.set(p.key, { t, label: p.label, source });
        else if (SOURCE_RANK[source] < SOURCE_RANK[have.source]) have.source = source;
      }
      if (picked.size === 0) return [];
      // One read of the learner's words, one dictionary request, one Anki request.
      const infoByKey = new Map((await repo.words(lang)).map((w) => [w.key, w]));
      const chosen = [...picked.entries()].filter(([key]) => {
        const state = infoByKey.get(key)?.state;
        return state !== "known" && state !== "ignored";
      });
      const infos = chosen.map(([key]) => infoByKey.get(key) ?? null);
      const dict = await dictionaryFor([...new Set(chosen.map(([, c]) => c.t.lemma))]);
      const ankis = await liveAnkiBatch(infos);
      const spans = sentenceSpans(v.tokens);
      const rows = chosen.map(([key, c], n) => {
        const entry = describeWord(v, c.t, spans, {
          key,
          info: infos[n] ?? null,
          label: c.label,
          dict,
          anki: ankis[n]!,
        });
        return {
          key,
          lemma: entry.lemma,
          ...(entry.article ? { article: entry.article } : {}),
          pos: entry.pos,
          glosses: entry.glosses,
          sentence: entry.sentence,
          sentenceHighlight: entry.sentenceHighlight,
          tokenIndex: entry.tokenIndex,
          source: c.source,
          entry,
        };
      });
      // One translation request for all row sentences.
      const translations = await translateSentences(rows.map((r) => r.sentence));
      for (const r of rows) {
        const tr = translations.get(r.sentence);
        if (tr) r.entry.sentenceTranslation = tr;
      }
      return rows;
    },

    async glosses(textId: string, tokenIndices: number[]): Promise<Record<number, string>> {
      const v = await view(textId);
      if (!v) return {};
      const m = await model();
      const items = tokenIndices.flatMap((i) => {
        const clicked = v.tokens[i];
        if (!clicked) return [];
        const t =
          clicked.particle_of !== null ? (v.tokens[clicked.particle_of] ?? clicked) : clicked;
        return [{ i, key: matchToken(t, m) ?? normalizeKey(t.lemma), lemma: t.lemma, pos: t.pos }];
      });
      const { found } = await lookupGlosses(items);
      const out: Record<number, string> = {};
      for (const it of items) {
        const g = found.get(it.key);
        if (g) out[it.i] = g;
      }
      return out;
    },

    async addToAnki(entry: InspectorEntry, opts?: AddOptions) {
      const { noteId, deck } = await addWordToAnki(
        await anki(),
        record,
        await addRequest(entry, opts),
      );
      changed();
      return { noteId, deck };
    },

    async learnNext(entry: InspectorEntry): Promise<{ deck: string }> {
      const noteId = entry.anki.noteIds[0];
      if (noteId === undefined) throw new Error("This word has no card in Anki");
      const { repositioned, unsuspended } = await learnNext(await anki(), entry.anki.cardIds);
      if (repositioned.length === 0) throw new Error("Its card is no longer new in Anki");
      await repo.append({
        type: "CardsPrioritized",
        lang: (await settings()).lang,
        key: entry.key,
        noteId,
        cardIds: repositioned,
        unsuspended,
      });
      changed();
      return { deck: entry.anki.deck ?? "" };
    },

    async markKnown(entry: InspectorEntry, opts?: AddOptions): Promise<{ addedToDeck?: string }> {
      if (entry.anki.status === "unavailable") {
        throw new Error(entry.anki.detail ?? "Anki is not reachable");
      }
      const s = await settings();
      let noteIds = entry.anki.noteIds;
      let cardIds = entry.anki.cardIds;
      let addedToDeck: string | undefined;
      if (cardIds.length > 0) {
        await markKnownInAnki(await anki(), cardIds);
      } else {
        // Not in Anki: add the note, then mark it known.
        const added = await addWordToAnki(await anki(), record, {
          ...(await addRequest(entry, opts)),
          asKnown: true,
        });
        noteIds = [added.noteId];
        cardIds = added.cardIds;
        addedToDeck = added.deck;
      }
      await repo.append({
        type: "MarkedKnownInAnki",
        lang: s.lang,
        key: entry.key,
        noteIds,
        cardIds,
      });
      changed();
      return addedToDeck ? { addedToDeck } : {};
    },

    async resetWordState(key: string): Promise<void> {
      await repo.append({ type: "WordStateCleared", lang: (await settings()).lang, key });
      changed();
    },

    async setWordState(key: string, state: WordState): Promise<void> {
      await repo.append({ type: "WordStateSet", lang: (await settings()).lang, key, state });
      changed();
    },

    async recordLookup(textId: string, key: string): Promise<void> {
      await repo.append({ type: "WordLookedUp", lang: (await settings()).lang, key, textId });
      // The word becomes "seen": refresh counts, but keep the current page's plan stable.
      modelCache = null;
    },

    async finishSegment(textId, segment, outcome): Promise<StaircaseState> {
      const { lang } = await settings();
      const current = (await repo.staircase(lang)) ?? DEFAULT_STAIRCASE;
      const next = updateStaircase(current, outcome);
      await repo.append({ type: "ReadingProgress", textId, segment, ...outcome });
      await repo.append({ type: "StaircaseUpdated", lang, state: next });
      changed();
      return next;
    },

    getSettings: settings,

    async saveSettings(patch: Partial<Settings>): Promise<void> {
      const next = { ...(await settings()), ...patch };
      // Secrets never go into the append-only (later: synced) event log.
      if ("ankiKey" in patch) writeSecret(ANKI_KEY_STORAGE, patch.ankiKey ?? "");
      const persisted: Partial<Settings> = { ...next };
      delete persisted.ankiKey;
      await repo.append({ type: "SettingChanged", key: "settings", value: persisted });
      settingsCache = next;
      if ("newWords" in patch || "lang" in patch) changed();
    },

    async ankiStatus(): Promise<AnkiStatus> {
      return toAnkiStatus(await probeAnki(await ankiOptions()));
    },

    async connectAnki(): Promise<AnkiConnectResult> {
      const outcome = await requestAnkiPermission(await ankiOptions());
      const status = toAnkiStatus(await probeAnki(await ankiOptions()));
      return { denied: outcome.outcome === "denied", status };
    },

    async syncAnki(onProgress?: (msg: string) => void): Promise<LearnerSummary> {
      const { lang } = await settings();
      // The confirmed sources of the language profile, plus destination and course decks.
      const snap = await profile.snapshot(onProgress);
      await repo.append({
        type: "AnkiSnapshotImported",
        lang,
        entries: snap.entries,
        sources: snap.sources.map((s) => s.deck),
      });
      changed();
      planCache.clear();
      glossCache.clear();
      return summary();
    },

    learnerSummary: summary,

    async words(opts = {}) {
      const { lang } = await settings();
      return repo.words(lang, opts);
    },
  };
  return services;
}
