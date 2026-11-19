/**
 * Texts and reading: import, analysis by the language server, the Library list, reading plans
 * (cached per learner-model version) and what reading records (lookups, cloze answers,
 * finished segments).
 */
import {
  type AnalyzedToken,
  DEFAULT_PLANNER,
  type LearnerModel,
  type PlannerOptions,
  type SegmentPlan,
  type StaircaseState,
  classifyTokens,
  estimateVocabulary,
  matchToken,
  normalizeKey,
  planText,
  textDifficulty,
  updateStaircase,
} from "@app/core";
import {
  type KenningRepository,
  type StoredText,
  type TextSource,
  contentHash,
  createUlidGenerator,
} from "@app/db";
import type { NlpClient } from "@app/nlp-client";
import { IN_SENTENCE, type LiveDictionary } from "./liveDictionary.js";
import { DEFAULT_STAIRCASE, type LearnerCache } from "./liveLearner.js";
import { fetchTexts } from "./textBatch.js";
import { ImportCancelledError } from "./ocrReview.js";
import type {
  AppServices,
  ImportInput,
  ImportOptions,
  ReadingView,
  Settings,
  TextListItem,
} from "./types.js";

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
function mergeChunkTokens(chunks: { start: number; tokens: AnalyzedToken[] }[]): AnalyzedToken[] {
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

/** Text ids: ULIDs (`crypto.randomUUID` does not exist in insecure http contexts). */
const nextUlid = createUlidGenerator();

export interface LiveTextsDeps {
  repo: KenningRepository;
  settings: () => Promise<Settings>;
  nlp: () => Promise<NlpClient>;
  learner: LearnerCache;
  dictionary: LiveDictionary;
  /** After importing a PDF or a photo: make its Library cover (best effort; liveLibrary). */
  autoCover: (textId: string, file: Blob, filename: string, nlp: NlpClient) => Promise<void>;
  /** Native mode: reading and blanks as evidence for the word's card (liveNative). */
  evidence?: () => ReadingEvidence;
}

/** What reading tells the native cards (see liveNative `evidence`). */
interface ReadingEvidence {
  lookup: (key: string) => Promise<unknown>;
  cloze: (key: string, correct: boolean, hinted: boolean) => Promise<unknown>;
  pageRead: (keys: string[]) => Promise<unknown>;
}

/** Evidence is a side effect: a failure never stops reading. */
const quietly = (p: Promise<unknown> | undefined) =>
  p?.catch((e: unknown) => console.warn("Could not update the card:", e));

export function createLiveTexts({
  repo,
  settings,
  nlp,
  learner,
  dictionary,
  autoCover,
  evidence,
}: LiveTextsDeps) {
  // Text content never changes under an id within this client (imports get new ids); another
  // device's changes clear the cache through `checkRemoteChanges`.
  const planCache = new Map<string, { version: number; view: ReadingView }>();
  const inFlight = new Map<string, Promise<ReadingView | null>>();

  async function plannerOptions(m: LearnerModel): Promise<PlannerOptions> {
    const s = await settings();
    const st = (await learner.staircase(s.lang)) ?? DEFAULT_STAIRCASE;
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
    // Derived data: kept in this device's analysis cache, not in the synced event log.
    await repo.saveTextAnalysis({
      textId: text.id,
      contentHash: contentHash(text.content),
      tokens,
      analyzerVersion: analyses[0]?.analyzerVersion ?? null,
    });
    return tokens;
  }

  // Texts analysed before the language server's analyzer appeared on this device are
  // re-analysed once, in the background, when opened. A different but not newer analysis (an
  // older analyzer brought back, another device's analysis from an old log) is kept. The
  // server's version is asked once per session (null: unknown or offline).
  let serverAnalyzer: Promise<{ version: string; since: number } | null> | null = null;
  const refreshed = new Set<string>();
  function refreshIfStale(text: StoredText): void {
    if (!text.tokens || refreshed.has(text.id)) return;
    refreshed.add(text.id);
    serverAnalyzer ??= nlp()
      .then((c) => c.health())
      .then(
        async (h) =>
          h.analyzerVersion
            ? { version: h.analyzerVersion, since: await repo.analyzerSeen(h.analyzerVersion) }
            : null,
        () => null,
      );
    void serverAnalyzer
      .then(async (current) => {
        if (!current || current.version === text.analyzerVersion) return;
        if ((text.analyzedAt ?? 0) >= current.since) return;
        await analyze(text);
        planCache.delete(text.id);
      })
      .catch(() => {
        // Offline or the text is gone: the stored analysis stays in use.
      });
  }

  /** Concurrent callers for the same text share one computation (and one analysis). */
  function view(textId: string): Promise<ReadingView | null> {
    const running = inFlight.get(textId);
    if (running) return running;
    const p = computeView(textId).finally(() => inFlight.delete(textId));
    inFlight.set(textId, p);
    return p;
  }

  /** A fresh cached view (same learner-model version), if any. */
  function cachedView(textId: string): ReadingView | null {
    const cached = planCache.get(textId);
    return cached && cached.version === learner.version() ? cached.view : null;
  }

  async function computeView(textId: string): Promise<ReadingView | null> {
    const hit = cachedView(textId);
    if (hit) return hit;
    const text = await repo.getText(textId);
    if (!text) return null;
    return (await computeViews([text]))[0] ?? null;
  }

  /**
   * Plan several texts with one learner model, one planner-options read and one gloss lookup
   * for all their clozes (the Library plans every text).
   */
  async function computeViews(texts: StoredText[]): Promise<ReadingView[]> {
    if (texts.length === 0) return [];
    const version = learner.version();
    const m = await learner.model();
    const opts = await plannerOptions(m);
    const staircase = { targetCoverage: opts.targetCoverage, newWordBudget: opts.newWordBudget };
    const views: ReadingView[] = [];
    for (const text of texts) {
      if (text.tokens) refreshIfStale(text);
      const tokens = text.tokens ?? (await analyze(text));
      const plans: SegmentPlan[] = planText(tokens, m, opts, text.content);
      views.push({ text: { ...text, tokens }, tokens, plans, staircase });
    }
    const cacheable = await dropUnhintableClozes(views, m);
    if (cacheable && version === learner.version()) {
      for (const v of views) planCache.set(v.text.id, { version, view: v });
    }
    return views;
  }

  /**
   * A cloze needs a meaning hint to be fair (one sentence often fits several words), so clozes
   * whose word has no translation are turned back into normal words. One lookup for all views.
   */
  async function dropUnhintableClozes(views: ReadingView[], m: LearnerModel): Promise<boolean> {
    const keyOf = (t: AnalyzedToken) => matchToken(t, m) ?? normalizeKey(t.lemma);
    const clozeTokens = views.flatMap((v) =>
      v.plans.flatMap((p) => p.clozes).map((i) => v.tokens[i]!),
    );
    if (!clozeTokens.length) return true;
    const { found, complete } = await dictionary.lookupGlosses(
      clozeTokens.map((t) => ({ key: keyOf(t), lemma: t.lemma, pos: t.pos })),
    );
    // Dictionary unreachable: keep the clozes rather than silently removing them all.
    if (!complete) return false;
    for (const { tokens, plans } of views) {
      let base: ReturnType<typeof classifyTokens> | null = null;
      for (const plan of plans) {
        const drop = new Set(plan.clozes.filter((i) => !found.has(keyOf(tokens[i]!))));
        if (!drop.size) continue;
        base ??= classifyTokens(tokens, m);
        plan.clozes = plan.clozes.filter((i) => !drop.has(i));
        for (const p of plan.tokens) if (drop.has(p.i)) p.label = base[p.i]?.label ?? "known";
      }
    }
    return true;
  }

  /** Save a generated story as a Library text; analysed now when the server is up. */
  async function saveText(t: { title: string; content: string; source: TextSource }) {
    const textId = nextUlid();
    await repo.append({
      type: "TextImported",
      textId,
      title: t.title,
      lang: (await settings()).lang,
      source: t.source,
      content: t.content,
    });
    // The reader analyses on open otherwise: a paid story is never dropped because the
    // language server is down.
    const stored = await repo.getText(textId);
    // Expected when the server is down (the outage shows in the degraded indicator).
    if (stored) await analyze(stored).catch(() => undefined);
    return textId;
  }

  const services: Pick<
    AppServices,
    | "listTexts"
    | "getReading"
    | "importText"
    | "deleteText"
    | "glosses"
    | "recordLookup"
    | "recordClozeAnswer"
    | "finishSegment"
  > = {
    async listTexts(): Promise<TextListItem[]> {
      const texts = await repo.listTexts();
      // Plan the analysed texts without a fresh cached plan together: batched text reads and
      // one gloss lookup instead of several calls per text.
      const stale = texts.filter((t) => t.analyzed && !cachedView(t.id));
      const planned = new Map(
        (await computeViews(await fetchTexts(repo, stale))).map((v) => [v.text.id, v]),
      );
      return texts.map((t) => {
        const v = t.analyzed ? (cachedView(t.id) ?? planned.get(t.id)) : undefined;
        const d = v ? textDifficulty(v.plans) : null;
        return {
          ...t,
          coverage: d?.coverage ?? null,
          newTypes: d?.newTypes ?? null,
          pages: v ? v.plans.length : null,
        };
      });
    },

    getReading: view,

    async importText(
      input: ImportInput,
      onProgress?: (msg: string) => void,
      opts: ImportOptions = {},
    ): Promise<string> {
      const client = await nlp();
      /** OCR, then (when asked for and something looks misread) the learner's review. */
      const recognise = async (file: File): Promise<string> => {
        const r = await client.ocr(file, "nl", file.name, { review: Boolean(opts.review) });
        if (!opts.review || !r.review || r.review.flags.length === 0) return r.text;
        onProgress?.("Waiting for your check of the text…");
        const checked = await opts.review({
          text: r.text,
          flags: r.review.flags,
          pages: r.review.pages,
        });
        if (checked === null) throw new ImportCancelledError();
        return checked;
      };
      let title: string;
      let content: string;
      let ref: string | undefined;
      if (input.kind === "paste" || input.kind === "talk") {
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
          content = await recognise(input.file);
        } else content = pdf.text;
        title = input.title?.trim() || pdf.title || input.file.name.replace(/\.pdf$/i, "");
        ref = input.file.name;
      } else {
        onProgress?.("Recognising text in the photo…");
        content = await recognise(input.file);
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
      if (input.kind === "pdf" || input.kind === "image") {
        onProgress?.("Making a cover…");
        await autoCover(textId, input.file, input.file.name, client);
      }
      return textId;
    },

    async deleteText(textId: string): Promise<void> {
      await repo.append({ type: "TextDeleted", textId });
      planCache.delete(textId);
    },

    async glosses(
      textId: string,
      tokenIndices: number[],
    ): Promise<Record<number, { text: string; note?: string }>> {
      const v = await view(textId);
      if (!v) return {};
      const m = await learner.model();
      const items = tokenIndices.flatMap((i) => {
        const clicked = v.tokens[i];
        if (!clicked) return [];
        const t =
          clicked.particle_of !== null ? (v.tokens[clicked.particle_of] ?? clicked) : clicked;
        return [
          { i, t, key: matchToken(t, m) ?? normalizeKey(t.lemma), lemma: t.lemma, pos: t.pos },
        ];
      });
      const { found, notes, guesses } = await dictionary.lookupGlosses(items);
      const out: Record<number, { text: string; note?: string }> = {};
      for (const it of items) {
        const g = found.get(it.key);
        const note = notes.get(it.key);
        if (g) out[it.i] = note ? { text: g, note } : { text: g };
      }
      // Words without a meaning or with only a compound guess: the English they became in their
      // sentence's translation (above a compound guess only when the alignment is confident).
      const missing = items.filter(
        (it) => (!found.has(it.key) || guesses.get(it.key) === "compound") && it.t.is_word,
      );
      if (missing.length) {
        const spans = new Map<number, [number, number]>();
        for (const t of v.tokens) {
          const s = spans.get(t.sent);
          if (s) s[1] = t.end;
          else spans.set(t.sent, [t.start, t.end]);
        }
        const words = missing.map((it) => {
          const hasGuess = found.has(it.key);
          const [s0, s1] = spans.get(it.t.sent) ?? [it.t.start, it.t.end];
          return {
            i: it.i,
            hasGuess,
            sentence: v.text.content.slice(s0, s1),
            start: it.t.start - s0,
            end: it.t.end - s0,
          };
        });
        const aligned = await dictionary.alignWords(words);
        for (const w of words) {
          const a = aligned.get(dictionary.alignKey(w));
          if (a && (a.confident || !w.hasGuess)) out[w.i] = { text: a.text, note: IN_SENTENCE };
        }
      }
      return out;
    },

    async recordLookup(textId: string, key: string): Promise<void> {
      await repo.append({ type: "WordLookedUp", lang: (await settings()).lang, key, textId });
      await quietly(evidence?.().lookup(key));
      // The word becomes "seen": refresh counts, but keep the current page's plan stable.
      learner.refreshModel();
    },

    async recordClozeAnswer(key: string, correct: boolean, hinted: boolean): Promise<void> {
      const { lang } = await settings();
      await repo.append({ type: "ClozeAnswered", lang, key, correct, hinted, at: Date.now() });
      await quietly(evidence?.().cloze(key, correct, hinted));
      // Like a lookup: refresh counts later, keep the current page's plan stable.
      learner.refreshModel();
    },

    async finishSegment(textId, segment, outcome): Promise<StaircaseState> {
      const { lang } = await settings();
      const current = (await repo.staircase(lang)) ?? DEFAULT_STAIRCASE;
      const next = updateStaircase(current, outcome);
      await repo.append({ type: "ReadingProgress", textId, segment, ...outcome });
      await repo.append({ type: "StaircaseUpdated", lang, state: next });
      if (evidence) await quietly(pageWords(lang, textId, segment).then(evidence().pageRead));
      learner.changed();
      return next;
    },
  };

  /** The words of a page met without a lookup in this text (blanks are answers, not reading). */
  async function pageWords(lang: string, textId: string, segment: number): Promise<string[]> {
    const plan = (await view(textId))?.plans[segment];
    if (!plan) return [];
    const looked = new Set(await repo.lookedUpKeys(lang, textId));
    return [
      ...new Set(
        plan.tokens
          .filter((t) => (t.label === "known" || t.label === "learning") && t.key)
          .map((t) => t.key!)
          .filter((k) => !looked.has(k)),
      ),
    ];
  }

  return {
    view,
    analyze,
    saveText,
    /** Plans depend on card glosses and shared data: recompute them (sync, another device). */
    clearPlans: () => planCache.clear(),
    /** One text changed (its details or cover): plan it again. */
    forget: (textId: string) => planCache.delete(textId),
    services,
  };
}

export type LiveTexts = ReturnType<typeof createLiveTexts>;
