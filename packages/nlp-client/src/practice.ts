/**
 * Practice data (word forms, example sentences, similar words) over `NlpClient`, with one cache
 * shared by practice and courses (review item A9). Every call degrades to empty data on any
 * failure (HTTP error, 503 for a missing dictionary, network error), and `degraded()` says so,
 * so practice still works with what Anki and the learner's texts provide. Successful answers,
 * including "nothing found", are cached per (server URL, lang, lemma, pos); failures never are,
 * so a server that comes up later is used.
 */
import type { ExampleSentence, LemmaPos, NlpClient, NlpLang, WordForms } from "./index.js";

export interface PracticeData {
  forms(lang: string, items: LemmaPos[]): Promise<Record<string, WordForms>>;
  sentences(
    lang: string,
    lemmas: string[],
    opts: { limit: number; maxWords: number },
  ): Promise<Record<string, ExampleSentence[]>>;
  similar(lang: string, items: LemmaPos[], k: number): Promise<Record<string, string[]>>;
  /** True when the most recent server request failed. */
  degraded(): boolean;
}

/** Max lemmas per request (the client splits larger requests further if needed). */
const BATCH = 200;

/** Create the cached wrapper. `client` is read per call (the NLP URL setting can change). */
export function createPracticeData(client: () => NlpClient | Promise<NlpClient>): PracticeData {
  const cache = new Map<string, unknown>();
  let failed = false;

  async function cached<T>(
    tag: string,
    lang: string,
    items: LemmaPos[],
    request: (nlp: NlpClient, batch: LemmaPos[]) => Promise<Record<string, T>>,
    isEmpty: (v: T) => boolean,
    empty: T,
  ): Promise<Record<string, T>> {
    const nlp = await client();
    const k = (i: LemmaPos) => `${nlp.url}|${tag}|${lang}|${i.lemma}|${i.pos}`;
    const todo = items.filter((i) => !cache.has(k(i)));
    for (let n = 0; n < todo.length; n += BATCH) {
      const batch = todo.slice(n, n + BATCH);
      let got: Record<string, T> | null;
      try {
        const res = await request(nlp, batch);
        got = res && typeof res === "object" ? res : null;
      } catch {
        // optional data: `failed` makes degraded() true, which the practice screen shows
        got = null;
      }
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
  const L = (lang: string) => lang as NlpLang;

  return {
    degraded: () => failed,
    forms: (lang, items) =>
      cached<WordForms>("forms", lang, items, (nlp, b) => nlp.forms(L(lang), b), emptyObj, {}),
    sentences: (lang, lemmas, { limit, maxWords }) =>
      cached<ExampleSentence[]>(
        `sent${limit}/${maxWords}`,
        lang,
        lemmas.map((lemma) => ({ lemma, pos: "" })),
        (nlp, b) =>
          nlp.sentences(
            L(lang),
            b.map((i) => i.lemma),
            { limit, maxWords },
          ),
        emptyList,
        [],
      ),
    similar: (lang, items, k) =>
      cached<string[]>(
        `sim${k}`,
        lang,
        items,
        (nlp, b) => nlp.similar(L(lang), b, k),
        emptyList,
        [],
      ),
  };
}
