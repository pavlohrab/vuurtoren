/**
 * Practice data from the NLP server: word forms, example sentences and similar words.
 * Thin typed wrapper over `fetch` (request shapes match server/nlp; see packages/nlp-client). Every call degrades
 * to empty data on 404 / 503 / network errors (and `degraded()` says so), so practice still works with what Anki and the
 * learner's texts provide.
 *
 * Endpoints (POST JSON, answers keyed by lemma):
 *   /forms     { lang, lemmas: [{lemma, pos}] }             -> Record<lemma, WordForms>
 *   /sentences { lang, lemmas, limit, maxWords }            -> Record<lemma, ExampleSentence[]>
 *   /similar   { lang, words: [{lemma, pos}], k }           -> Record<lemma, string[]>
 */
import type { ExampleSentence, WordForms } from "@app/core";

export interface LemmaPos {
  lemma: string;
  pos: string;
}

export interface PracticeData {
  forms(lang: string, items: LemmaPos[]): Promise<Record<string, WordForms>>;
  sentences(
    lang: string,
    lemmas: string[],
    opts: { limit: number; maxWords: number },
  ): Promise<Record<string, ExampleSentence[]>>;
  similar(lang: string, items: LemmaPos[], k: number): Promise<Record<string, string[]>>;
  /** True when the most recent server request failed (network error / non-OK response). */
  degraded(): boolean;
}

/** Max lemmas per request. */
const BATCH = 200;

/**
 * Create the wrapper. `baseUrl` is read per call (the setting can change); successful
 * responses (including "nothing found") are cached per (baseUrl, lang, lemma, pos); failures are
 * never cached, so a server that comes up later is used.
 */
export function createPracticeData(
  baseUrl: () => Promise<string> | string,
  fetchFn: () => typeof fetch = () => globalThis.fetch,
): PracticeData {
  const cache = new Map<string, unknown>();
  let failed = false;

  /** POST JSON; null on any failure (so callers can avoid caching it). */
  async function post<T>(
    base: string,
    path: string,
    body: unknown,
  ): Promise<Record<string, T> | null> {
    try {
      const res = await fetchFn()(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      return data && typeof data === "object" ? (data as Record<string, T>) : null;
    } catch {
      return null;
    }
  }

  /** Cached, batched lookup: only misses go to the server; "nothing found" is remembered too. */
  async function cached<T>(
    path: string,
    tag: string,
    lang: string,
    items: LemmaPos[],
    request: (batch: LemmaPos[]) => unknown,
    isEmpty: (v: T) => boolean,
    empty: T,
  ): Promise<Record<string, T>> {
    const base = await baseUrl();
    const k = (i: LemmaPos) => `${base}|${tag}|${lang}|${i.lemma}|${i.pos}`;
    const todo = items.filter((i) => !cache.has(k(i)));
    for (let n = 0; n < todo.length; n += BATCH) {
      const batch = todo.slice(n, n + BATCH);
      const got = await post<T>(base, path, request(batch));
      failed = got === null;
      if (got) for (const i of batch) cache.set(k(i), got[i.lemma] ?? empty);
    }
    const out: Record<string, T> = {};
    for (const i of items) {
      const v = cache.get(k(i)) as T | undefined;
      if (v !== undefined && !isEmpty(v)) out[i.lemma] = v;
    }
    return out;
  }

  const emptyObj = (v: object) => Object.keys(v).length === 0;
  const emptyList = (v: unknown[]) => v.length === 0;

  return {
    degraded: () => failed,
    forms: (lang, items) =>
      cached<WordForms>("/forms", "forms", lang, items, (b) => ({ lang, lemmas: b }), emptyObj, {}),
    sentences: (lang, lemmas, { limit, maxWords }) =>
      cached<ExampleSentence[]>(
        "/sentences",
        `sent${limit}/${maxWords}`,
        lang,
        lemmas.map((lemma) => ({ lemma, pos: "" })),
        (b) => ({ lang, lemmas: b.map((i) => i.lemma), limit, maxWords }),
        emptyList,
        [],
      ),
    similar: (lang, items, k) =>
      cached<string[]>(
        "/similar",
        `sim${k}`,
        lang,
        items,
        (b) => ({ lang, words: b, k }),
        emptyList,
        [],
      ),
  };
}
