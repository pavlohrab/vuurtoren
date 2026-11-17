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

/** Languages Tesseract can read via `/ocr` (nl -> nld, uk -> ukr, en -> eng). */
export type OcrLang = "nl" | "uk" | "en";

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
    try {
      res = await this.fetchImpl(`${this.url}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
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
}
