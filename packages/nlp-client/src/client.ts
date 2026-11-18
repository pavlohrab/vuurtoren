/** HTTP client for server/nlp (see ADR 0004). Types mirror server/nlp/src/kenning_nlp/models.py. */

export type NlpLang = "nl";

export interface Token {
  i: number;
  text: string;
  lemma: string;
  /** Other plausible lemmas (model vs dictionary); the matcher tries all of them. */
  alt_lemmas: string[];
  pos: string;
  morph: string;
  dep: string;
  head: number;
  sent: number;
  start: number;
  end: number;
  is_word: boolean;
  is_propn: boolean;
  is_num: boolean;
  particle_of: number | null;
  /** wordfreq Zipf frequency of the lemma: ~7 very common, ~1 rare, 0 unknown. */
  zipf: number;
}

export interface TextAnalysis {
  tokens: Token[];
}

export interface TermAnalysis {
  input: string;
  /** Normalised headword (citation form). Empty if the field had nothing usable. */
  key: string;
  /** Alternative forms given on the card (e.g. "ze" for "zij, ze"). */
  aliases: string[];
  /** spaCy's lemma guess, informational only. */
  lemma: string;
  pos: string;
  article: string | null;
  reflexive: boolean;
  multiword: boolean;
}

export interface Detection {
  lang: string | null;
  confidence: number;
}

/**
 * Languages Tesseract can read via `/ocr` and `/course/ocr` (nl -> nld, uk -> ukr, en -> eng,
 * de -> deu, ...); the server reports a missing language pack with an install hint.
 */
export type OcrLang = "nl" | "uk" | "en" | "de" | "fr" | "es" | "it" | "pt" | "sv" | "da" | "pl";

/** True when `lang` is a code the OCR endpoints accept. */
export const isOcrLang = (lang: string): lang is OcrLang =>
  ["nl", "uk", "en", "de", "fr", "es", "it", "pt", "sv", "da", "pl"].includes(lang);

export interface UrlExtraction {
  title: string;
  text: string;
  /** Final URL after redirects. */
  url: string;
}

export interface PdfExtraction {
  title: string;
  text: string;
  pages: number;
  /** True when the PDF has (almost) no text layer: send it to `ocr()` instead. */
  needs_ocr: boolean;
}

export interface OcrResult {
  text: string;
  /** Mean word confidence, 0..1. */
  confidence: number;
  pages: number;
}

/** One OCR'd page of a course job: full text plus layout blocks (box = fractions of the page). */
export interface CoursePage {
  n: number;
  text: string;
  confidence: number;
  blocks: { text: string; x: number; y: number; w: number; h: number }[];
}

/** Progress of a `/course/ocr` job; `pages` holds the pages from the requested index on. */
export interface CourseOcrStatus {
  id: string;
  status: "running" | "done" | "error";
  error: string | null;
  done: number;
  total: number;
  /** Pages that needed no OCR (cache hits, text layer, EPUB). */
  cached?: number;
  /** Seconds since the job started. */
  elapsed?: number;
  /** Estimated seconds left, or null before there is a pace. */
  eta?: number | null;
  pages: CoursePage[];
}

export interface GlossEntry {
  pos: string;
  /** "de" / "het" for nouns ("de/het" if senses disagree), else null. */
  article: string | null;
  /** Short English senses (at most 5). */
  glosses: string[];
  /**
   * True when the word has no dictionary entry and was analysed as a Dutch compound. Then
   * `glosses` is a single readable string like "souvenir shop (souvenir + winkel)", and `pos` /
   * `article` are the head's (last part). Absent for ordinary entries.
   */
  compound?: boolean;
  /** Compound parts in order (only when `compound`); `gloss` is the part's first full sense. */
  parts?: { part: string; gloss: string | null }[];
}

/** Gloss lookup result: every requested word maps to its entries (empty if unknown). */
export type GlossResult = Record<string, GlossEntry[]>;

/** Languages `/translate` supports (offline OPUS-MT): Dutch to English only for now. */
export interface TranslateOptions {
  source?: "nl";
  target?: "en";
  /** The texts are consecutive sentences of one document (accepted; no effect yet). */
  context?: boolean;
}

export interface Translation {
  /** The input text, echoed. */
  text: string;
  translation: string;
}

/** A lemma with its spaCy universal POS (`VERB`, `NOUN`, `ADJ`, ...). */
export interface LemmaPos {
  lemma: string;
  pos: string;
}

/**
 * Morphology for form exercises (`/forms`). Mirrors `WordForms` in `@app/core`
 * (packages/core/src/practice/types.ts); every field is omitted when unknown. For separable
 * verbs `past` / `present` are the main-clause forms with the particle ("belde op", "bel op").
 */
export interface WordForms {
  participle?: string;
  aux?: "hebben" | "zijn" | "both";
  past?: [string, string];
  present?: Partial<Record<"ik" | "jij" | "hij" | "wij" | "jullie" | "zij", string>>;
  separable?: { particle: string; stem: string };
  plural?: string;
  diminutive?: string;
  inflected?: string;
  comparative?: string;
  superlative?: string;
}

/** Tatoeba example sentence (`/sentences`); `target` = [start, end) of the word, UTF-16 offsets. */
export interface ExampleSentence {
  text: string;
  translation?: string;
  target: [number, number];
  source: "anki" | "text" | "tatoeba";
}

export interface SentencesOptions {
  /** Sentences per lemma (server: 1-10, default 3). */
  limit?: number;
  /** Maximum words per sentence (server: 3-40, default 15). */
  maxWords?: number;
}

/**
 * One grammar construction found by `/grammar` (mirrors `GrammarHit` in models.py). `tokens` index
 * the tokens `/analyze/text` returns for the same text; `start`/`end` are the sentence's
 * UTF-16 offsets in that text.
 */
export interface GrammarHit {
  /** Grammar topic id (a page in packages/content/grammar, e.g. "inversion"). */
  topic: string;
  tokens: number[];
  /** Sentence number (`Token.sent`). */
  sent: number;
  sentence: string;
  start: number;
  end: number;
  /** One short plain-English line about this occurrence. */
  note: string;
}

/** A Tatoeba sentence in which a topic's detector fired (`/grammar/examples`). */
export interface GrammarExample {
  text: string;
  translation: string;
  /** [start, end) UTF-16 spans of the construction's words in `text`. */
  marks: [number, number][];
  note: string;
  source: "tatoeba";
}

/** Server limit for `/grammar/examples?limit=`. */
const GRAMMAR_EXAMPLES_MAX = 10;
/** Characters per `/grammar` request (server: 2,000,000 in total). */
const GRAMMAR_CHARS = 1_000_000;

/** Max items per `/forms`, `/sentences` and `/similar` request (server limit). */
const PRACTICE_BATCH = 500;

export interface NlpClientOptions {
  url?: string;
  fetch?: typeof fetch;
  /** Max items per request; larger inputs are split. */
  batchSize?: number;
  /** Per-request timeout in ms (default 120 s; OCR of a multi-page PDF is slow). */
  timeoutMs?: number;
}

/** Error from the NLP service, carrying its HTTP status and `detail` message. */
export class NlpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "NlpError";
  }
}

export class NlpClient {
  readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  constructor(opts: NlpClientOptions = {}) {
    this.url = (opts.url ?? "http://localhost:8000").replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.batchSize = opts.batchSize ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    const send = () =>
      this.fetchImpl(`${this.url}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    try {
      try {
        res = await send();
      } catch (e) {
        // A kept-alive connection the server already closed fails once ("fetch failed"); every
        // JSON endpoint is a pure function, so one retry is safe. Uploads are not retried.
        if (!(e instanceof TypeError) || init.body instanceof FormData) throw e;
        res = await send();
      }
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "TimeoutError";
      throw new NlpError(
        timedOut
          ? `NLP ${path}: no answer within ${this.timeoutMs / 1000}s`
          : `NLP service unreachable at ${this.url} (${String(e)})`,
        null,
      );
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new NlpError(
        `NLP ${path}: HTTP ${res.status}, not JSON: ${text.slice(0, 120)}`,
        res.status,
      );
    }
    if (!res.ok) {
      const detail = (json as { detail?: unknown }).detail;
      throw new NlpError(
        `NLP ${path}: HTTP ${res.status} ${typeof detail === "string" ? detail : text.slice(0, 200)}`,
        res.status,
      );
    }
    return json as T;
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private postForm<T>(path: string, form: FormData): Promise<T> {
    return this.request<T>(path, { method: "POST", body: form });
  }

  private async batched<T>(
    path: string,
    texts: string[],
    extra: Record<string, unknown>,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      out.push(
        ...(await this.post<T[]>(path, { ...extra, texts: texts.slice(i, i + this.batchSize) })),
      );
    }
    return out;
  }

  health(): Promise<{ status: string; version: string }> {
    return this.request("/health");
  }

  analyzeText(lang: NlpLang, texts: string[]): Promise<TextAnalysis[]> {
    return this.batched("/analyze/text", texts, { lang });
  }

  analyzeTerms(lang: NlpLang, terms: string[]): Promise<TermAnalysis[]> {
    return this.batched("/analyze/terms", terms, { lang });
  }

  detect(texts: string[]): Promise<Detection[]> {
    return this.batched("/detect", texts, {});
  }

  /**
   * Start a background OCR job over a whole book: one PDF, or photos of its pages (read in the
   * given order as consecutive pages).
   */
  courseOcrStart(
    files: File | readonly File[],
    lang: OcrLang = "nl",
  ): Promise<{ id: string; total: number }> {
    const form = new FormData();
    const list: readonly File[] = files instanceof Blob ? [files] : files;
    for (const f of list) form.append("file", f, f.name);
    return this.postForm(`/course/ocr?lang=${lang}`, form);
  }

  /** Progress of an OCR job plus the pages with index >= `after`. */
  courseOcrStatus(id: string, after = 0): Promise<CourseOcrStatus> {
    return this.request(`/course/ocr/${encodeURIComponent(id)}?after=${after}`);
  }

  /** Stop an OCR job and free its memory on the server. */
  courseOcrCancel(id: string): Promise<{ status: string }> {
    return this.request(`/course/ocr/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }

  /** Fetch a web page server-side (SSRF-protected) and extract its main text. */
  extractUrl(url: string): Promise<UrlExtraction> {
    return this.post("/extract/url", { url });
  }

  /** Extract text from a text-layer PDF (max 30 MB). `needs_ocr` flags scans. */
  extractPdf(file: Blob, filename = "document.pdf"): Promise<PdfExtraction> {
    const form = new FormData();
    form.append("file", file, filename);
    return this.postForm("/extract/pdf", form);
  }

  /** OCR an image (png/jpg/webp/tiff) or PDF. Rejects with HTTP 503 if Tesseract is missing. */
  ocr(file: Blob, lang: OcrLang = "nl", filename = "scan"): Promise<OcrResult> {
    const form = new FormData();
    form.append("file", file, filename);
    return this.postForm(`/ocr?lang=${encodeURIComponent(lang)}`, form);
  }

  /**
   * Dictionary lookup (short English glosses); unknown Dutch compounds get a `compound` entry.
   * Split into requests of at most 1000 words (server limit 2000). Rejects with HTTP 503 if the
   * dictionary is not built.
   */
  async gloss(lang: NlpLang, words: string[]): Promise<GlossResult> {
    const out: GlossResult = {};
    for (let i = 0; i < words.length; i += 1000) {
      Object.assign(
        out,
        await this.post<GlossResult>("/gloss", { lang, words: words.slice(i, i + 1000) }),
      );
    }
    return out;
  }

  /**
   * Offline machine translation (default nl to en). Server limits are 64 texts of at most 2000
   * characters (20,000 in total), so larger inputs are split into requests of at most 64 texts
   * and 20,000 characters. Rejects with HTTP 503 if the model is not installed.
   */
  async translate(texts: string[], opts: TranslateOptions = {}): Promise<Translation[]> {
    const body = {
      source: opts.source ?? "nl",
      target: opts.target ?? "en",
      context: !!opts.context,
    };
    const out: Translation[] = [];
    let chunk: string[] = [];
    let chars = 0;
    const flush = async () => {
      if (chunk.length)
        out.push(...(await this.post<Translation[]>("/translate", { ...body, texts: chunk })));
      chunk = [];
      chars = 0;
    };
    for (const t of texts) {
      if (chunk.length >= 64 || chars + t.length > 20_000) await flush();
      chunk.push(t);
      chars += t.length;
    }
    await flush();
    return out;
  }

  /**
   * Grammar constructions in each text (rule-based detectors), one list per text in input
   * order. Texts are sent in requests of at most 1,000,000 characters.
   */
  async grammar(lang: NlpLang, texts: string[]): Promise<GrammarHit[][]> {
    const out: GrammarHit[][] = [];
    let chunk: string[] = [];
    let chars = 0;
    const flush = async () => {
      if (chunk.length)
        out.push(...(await this.post<GrammarHit[][]>("/grammar", { lang, texts: chunk })));
      chunk = [];
      chars = 0;
    };
    for (const t of texts) {
      if (chunk.length && (chunk.length >= this.batchSize || chars + t.length > GRAMMAR_CHARS)) {
        await flush();
      }
      chunk.push(t);
      chars += t.length;
    }
    await flush();
    return out;
  }

  /**
   * Tatoeba example sentences for a grammar topic, best first (at most 10). Topics without a
   * detector give []. The server scans lazily, so a rare topic may return fewer at first.
   * Rejects with HTTP 503 if the sentence DB is not built.
   */
  grammarExamples(topic: string, limit = GRAMMAR_EXAMPLES_MAX): Promise<GrammarExample[]> {
    const n = Math.max(1, Math.min(GRAMMAR_EXAMPLES_MAX, Math.floor(limit)));
    return this.request(`/grammar/examples?topic=${encodeURIComponent(topic)}&limit=${n}`);
  }

  /** POST `path` in chunks of 500 items and merge the per-lemma result objects. */
  private async practiceBatched<T>(
    path: string,
    key: "lemmas" | "words",
    items: unknown[],
    extra: Record<string, unknown>,
  ): Promise<Record<string, T>> {
    const out: Record<string, T> = {};
    for (let i = 0; i < items.length; i += PRACTICE_BATCH) {
      Object.assign(
        out,
        await this.post<Record<string, T>>(path, {
          ...extra,
          [key]: items.slice(i, i + PRACTICE_BATCH),
        }),
      );
    }
    return out;
  }

  /**
   * Morphology (Wiktionary) per lemma for form exercises: `{ [lemma]: WordForms }` (`{}` when
   * unknown). Rejects with HTTP 503 if the dictionary is missing or built by an older version.
   */
  forms(lang: NlpLang, lemmas: LemmaPos[]): Promise<Record<string, WordForms>> {
    return this.practiceBatched("/forms", "lemmas", lemmas, { lang });
  }

  /**
   * Tatoeba example sentences with English translations, shortest / commonest vocabulary first:
   * `{ [lemma]: ExampleSentence[] }`. Rejects with HTTP 503 if the sentence DB is not built.
   */
  sentences(
    lang: NlpLang,
    lemmas: string[],
    opts: SentencesOptions = {},
  ): Promise<Record<string, ExampleSentence[]>> {
    return this.practiceBatched("/sentences", "lemmas", lemmas, {
      lang,
      ...(opts.limit !== undefined && { limit: opts.limit }),
      ...(opts.maxWords !== undefined && { maxWords: opts.maxWords }),
    });
  }

  /**
   * Distractor lemmas per word (same POS and frequency band, related but not synonyms):
   * `{ [lemma]: string[] }`. The first call after a server start takes a few seconds.
   */
  similar(lang: NlpLang, words: LemmaPos[], k?: number): Promise<Record<string, string[]>> {
    return this.practiceBatched("/similar", "words", words, {
      lang,
      ...(k !== undefined && { k }),
    });
  }
}
