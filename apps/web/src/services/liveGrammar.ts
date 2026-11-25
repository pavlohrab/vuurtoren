/**
 * Grammar services on top of the local database and the NLP service.
 *
 * Grammar hits are computed once per text content by `POST /grammar` and stored in this
 * device's analysis cache next to the tokens (same content hash, so editing a text invalidates
 * both; a new analyzer version drops the hits). Like the tokens they are not events. A bundled
 * story brings its hits, computed at build time by the same detectors, so it needs no request
 * (and gets marks without the server). The server analyses each chunk
 * again, so its token indices and offsets are rebased exactly like the analysis chunks
 * (`chunkText` / `mergeChunkTokens`) and checked against the stored tokens.
 */
import {
  type AnalyzedToken,
  type ExampleSentence,
  type GrammarHit,
  type LearnerModel,
  type TopicSentence,
  countHits,
  matchToken,
  normalizeKey,
} from "@app/core";
import { type VuurtorenRepository, type StoredText, contentHash } from "@app/db";
import { NlpError, type NlpClient } from "@app/nlp-client";
import type {
  GrammarOverview,
  LibraryGrammarExample,
  ReadingView,
  TatoebaGrammarExample,
  TopicExamples,
} from "./types.js";

/** Bump when the stored hit format or the rebasing changes: older hits are recomputed. */
export const GRAMMAR_VERSION = 1;
/** Max characters per /grammar request text (same chunks as /analyze/text). */
const CHUNK_CHARS = 40_000;

/** Material for a topic exercise session (see `buildTopicSession` in @app/core). */
export interface TopicMaterial {
  sentences: TopicSentence[];
  /** Words of the hits with the hit sentence they occur in. */
  words: { key: string; lemma: string; pos: string; zipf: number; sentence: ExampleSentence }[];
}

export interface LiveGrammarDeps {
  repo: VuurtorenRepository;
  nlp: () => Promise<NlpClient>;
  /** The analysed text (analysing it first if needed). */
  view: (textId: string) => Promise<ReadingView | null>;
  model: () => Promise<LearnerModel>;
  /** Split text into analysis chunks (shared with the analysis, see live.ts). */
  chunkText: (text: string, max?: number) => { start: number; text: string }[];
  /** Offline sentence translation; missing entries when unavailable. */
  translate: (sentences: string[]) => Promise<Map<string, string>>;
  /** A bundled story's precomputed hits for its analysed text, else null (see stories.ts). */
  storyGrammar?: (text: StoredText) => Promise<GrammarHit[] | null>;
}

/**
 * Rebase the hits of each chunk onto the whole text and drop any hit whose tokens do not match
 * the stored analysis (a different model version would give different token indices).
 */
export function rebaseHits(
  chunks: { start: number; text: string }[],
  perChunk: {
    topic: string;
    tokens: number[];
    sent: number;
    start: number;
    end: number;
    note: string;
  }[][],
  tokens: AnalyzedToken[],
): GrammarHit[] {
  const out: GrammarHit[] = [];
  let tokenBase = 0;
  let sentBase = 0;
  chunks.forEach((c, k) => {
    const end = c.start + c.text.length;
    const inChunk = tokens.filter((t) => t.start >= c.start && t.start < end);
    for (const h of perChunk[k] ?? []) {
      const hit: GrammarHit = {
        topic: h.topic,
        tokens: h.tokens.map((i) => i + tokenBase),
        sent: h.sent + sentBase,
        start: h.start + c.start,
        end: h.end + c.start,
        note: h.note,
      };
      const ok = hit.tokens.every((i) => {
        const t = tokens[i];
        return t !== undefined && t.sent === hit.sent && t.start >= hit.start && t.end <= hit.end;
      });
      if (ok && hit.tokens.length > 0) out.push(hit);
    }
    tokenBase += inChunk.length;
    if (inChunk.length) sentBase = Math.max(...inChunk.map((t) => t.sent)) + 1;
  });
  return out;
}

/** [start, end) of each hit token, relative to the hit's sentence. */
function marksOf(hit: GrammarHit, tokens: AnalyzedToken[]): [number, number][] {
  return hit.tokens
    .map((i) => tokens[i])
    .filter((t): t is AnalyzedToken => t !== undefined)
    .map((t) => [t.start - hit.start, t.end - hit.start] as [number, number])
    .sort((a, b) => a[0] - b[0]);
}

/** Parts of speech the word exercises (gender, separable, perfect, adjective-e…) work on. */
const WORD_POS = new Set(["NOUN", "VERB", "ADJ"]);

/**
 * A grammar request failed for another reason than an outage (which the NLP client watcher
 * reports as "nlp"): keep it in the console for bug reports, the screen shows the gap.
 */
function reportGrammarFailure(e: unknown): void {
  if (!(e instanceof NlpError && (e.status === null || e.status === 502 || e.status === 504))) {
    console.warn("[vuurtoren] grammar request failed:", e);
  }
}

export function createLiveGrammar(deps: LiveGrammarDeps) {
  const { repo } = deps;
  const inFlight = new Map<string, Promise<GrammarHit[]>>();

  /** Stored hits of a text, or compute and store them (one computation per text at a time). */
  function textGrammar(textId: string): Promise<GrammarHit[]> {
    const running = inFlight.get(textId);
    if (running) return running;
    const p = compute(textId).finally(() => inFlight.delete(textId));
    inFlight.set(textId, p);
    return p;
  }

  async function analysed(textId: string): Promise<StoredText | null> {
    const text = await repo.getText(textId);
    if (!text) return null;
    if (text.tokens) return text;
    const v = await deps.view(textId);
    return v ? { ...v.text, tokens: v.tokens } : null;
  }

  async function fromServer(text: StoredText, tokens: AnalyzedToken[]): Promise<GrammarHit[]> {
    const chunks = deps.chunkText(text.content, CHUNK_CHARS);
    const perChunk = await (
      await deps.nlp()
    ).grammar(
      "nl",
      chunks.map((c) => c.text),
    );
    return rebaseHits(chunks, perChunk, tokens);
  }

  async function compute(textId: string): Promise<GrammarHit[]> {
    const stored = await repo.textGrammar(textId);
    if (stored && stored.version === GRAMMAR_VERSION) return stored.hits;
    const text = await analysed(textId);
    if (!text?.tokens) return [];
    const hits = (await deps.storyGrammar?.(text)) ?? (await fromServer(text, text.tokens));
    await repo.saveTextGrammar({
      textId,
      contentHash: contentHash(text.content),
      version: GRAMMAR_VERSION,
      hits,
    });
    return hits;
  }

  /** Each analysed text with its hits (computed when missing); `missing` = texts that failed. */
  async function eachText(
    fn: (textId: string, hits: GrammarHit[]) => Promise<void> | void,
  ): Promise<{ texts: number; missing: number }> {
    const summaries = (await repo.listTexts()).filter((t) => t.analyzed);
    let texts = 0;
    let missing = 0;
    let serverDown = false;
    for (const s of summaries) {
      const stored = await repo.textGrammar(s.id);
      let hits: GrammarHit[] | null =
        stored && stored.version === GRAMMAR_VERSION ? stored.hits : null;
      if (!hits && !serverDown) {
        try {
          hits = await textGrammar(s.id);
        } catch (e) {
          // One failure (server down) is enough: do not wait for every text to time out. The
          // text counts as `missing` in the overview; an outage shows in the degraded indicator.
          serverDown = true;
          reportGrammarFailure(e);
        }
      }
      if (!hits) {
        missing++;
        continue;
      }
      texts++;
      await fn(s.id, hits);
    }
    return { texts, missing };
  }

  async function grammarOverview(): Promise<GrammarOverview> {
    const counts: Record<string, number> = {};
    const textCounts: Record<string, number> = {};
    const { texts, missing } = await eachText((_id, hits) => {
      for (const [topic, n] of Object.entries(countHits(hits))) {
        counts[topic] = (counts[topic] ?? 0) + n;
        textCounts[topic] = (textCounts[topic] ?? 0) + 1;
      }
    });
    return { counts, textCounts, texts, missing };
  }

  /** Library sentences with hits of `detects`, newest text first, one per sentence. */
  async function librarySentences(
    detects: ReadonlySet<string>,
    limit: number,
  ): Promise<{ example: LibraryGrammarExample; hit: GrammarHit; text: StoredText }[]> {
    const out: { example: LibraryGrammarExample; hit: GrammarHit; text: StoredText }[] = [];
    const seen = new Set<string>();
    await eachText(async (textId, hits) => {
      if (out.length >= limit) return;
      const wanted = hits.filter((h) => detects.has(h.topic));
      if (!wanted.length) return;
      const text = await repo.getText(textId);
      if (!text?.tokens) return;
      for (const hit of wanted) {
        if (out.length >= limit) break;
        const sentence = text.content.slice(hit.start, hit.end);
        const key = sentence.trim().replace(/\s+/g, " ");
        // Long sentences (or headings run into the text) make poor examples.
        if (seen.has(key) || sentence.includes("\n") || key.split(" ").length > 30) continue;
        seen.add(key);
        out.push({
          example: {
            textId,
            title: text.title,
            topic: hit.topic,
            sentence,
            marks: marksOf(hit, text.tokens),
            note: hit.note,
          },
          hit,
          text,
        });
      }
    });
    return out;
  }

  async function tatoeba(
    detects: string[],
    limit: number,
  ): Promise<{ examples: TatoebaGrammarExample[]; unavailable: boolean }> {
    const examples: TatoebaGrammarExample[] = [];
    let unavailable = false;
    const client = await deps.nlp();
    const seen = new Set<string>();
    for (const topic of detects) {
      try {
        for (const e of await client.grammarExamples(topic, limit)) {
          if (seen.has(e.text)) continue;
          seen.add(e.text);
          examples.push({
            topic,
            text: e.text,
            translation: e.translation,
            marks: e.marks,
            note: e.note,
          });
        }
      } catch (e) {
        // The screen shows "examples unavailable"; an outage shows in the degraded indicator.
        unavailable = true;
        reportGrammarFailure(e);
        break;
      }
    }
    return { examples, unavailable };
  }

  async function grammarExamples(
    detects: string[],
    opts: { limit?: number } = {},
  ): Promise<TopicExamples> {
    const limit = opts.limit ?? 8;
    if (detects.length === 0) return { library: [], tatoeba: [], tatoebaUnavailable: false };
    const [library, t] = await Promise.all([
      librarySentences(new Set(detects), limit),
      tatoeba(detects, Math.min(10, limit)),
    ]);
    return {
      library: library.map((l) => l.example),
      tatoeba: t.examples,
      tatoebaUnavailable: t.unavailable,
    };
  }

  /** Hit sentences and hit words for a topic session. */
  async function topicMaterial(detects: string[]): Promise<TopicMaterial> {
    const wanted = new Set(detects);
    const [lib, tat, model] = await Promise.all([
      librarySentences(wanted, 40),
      // Optional extra sentences; `unavailable` tells the screen, outages show in the indicator.
      tatoeba(detects, 10).catch(() => ({ examples: [], unavailable: true })),
      deps.model(),
    ]);
    const keyOf = (t: AnalyzedToken) => matchToken(t, model) ?? normalizeKey(t.lemma);
    const translations = await deps.translate(lib.map((l) => l.example.sentence));
    const sentences: TopicSentence[] = [];
    const words: TopicMaterial["words"] = [];
    for (const { example, hit, text } of lib) {
      const tokens = text.tokens ?? [];
      const own = hit.tokens.map((i) => tokens[i]).filter((t): t is AnalyzedToken => !!t);
      // A particle stands for its verb; a determiner or adjective also brings its noun.
      const candidates = new Map<number, AnalyzedToken>();
      for (const t of own) {
        const base = t.particle_of != null ? tokens[t.particle_of] : t;
        if (base) candidates.set(base.i, base);
        const head = tokens[t.head];
        if (head && head.pos === "NOUN" && head.sent === t.sent) candidates.set(head.i, head);
      }
      const first = own.find((t) => t.is_word);
      const ts: TopicSentence = {
        text: example.sentence,
        marks: example.marks,
        note: example.note,
        source: "text",
        key: first ? keyOf(first) : normalizeKey(example.sentence.split(/\s+/)[0] ?? ""),
      };
      const tr = translations.get(example.sentence);
      if (tr) ts.translation = tr;
      sentences.push(ts);
      for (const t of candidates.values()) {
        if (!t.is_word || t.is_propn || !WORD_POS.has(t.pos)) continue;
        const sentence: ExampleSentence = {
          text: example.sentence,
          target: [t.start - hit.start, t.end - hit.start],
          source: "text",
        };
        if (tr) sentence.translation = tr;
        words.push({
          key: keyOf(t),
          lemma: t.lemma,
          pos: t.pos,
          zipf: t.zipf,
          sentence,
        });
      }
    }
    for (const e of tat.examples) {
      const [s, end] = e.marks[0] ?? [0, 0];
      sentences.push({
        text: e.text,
        translation: e.translation,
        marks: e.marks,
        note: e.note,
        source: "tatoeba",
        key: normalizeKey(e.text.slice(s, end)),
      });
    }
    return { sentences, words };
  }

  /**
   * Grammar for every analysed text that has none yet (OF2), so the bundle sync sends a phone
   * is whole. One at a time; stops at the first failure (the language server isn't up yet).
   * Returns how many texts got their grammar.
   */
  async function fillGrammar(): Promise<number> {
    let made = 0;
    for (const s of (await repo.listTexts()).filter((t) => t.analyzed)) {
      const stored = await repo.textGrammar(s.id);
      if (stored && stored.version === GRAMMAR_VERSION) continue;
      try {
        await textGrammar(s.id);
        made++;
      } catch {
        break;
      }
    }
    return made;
  }

  return { textGrammar, grammarOverview, grammarExamples, topicMaterial, fillGrammar };
}
