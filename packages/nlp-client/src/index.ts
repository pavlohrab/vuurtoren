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
}

/** Gloss lookup result: every requested word maps to its entries (empty if unknown). */
export type GlossResult = Record<string, GlossEntry[]>;

export interface NlpClientOptions {
  url?: string;
  fetch?: typeof fetch;
  /** Max items per request; larger inputs are split. */
  batchSize?: number;
}

export class NlpClient {
  readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly batchSize: number;

  constructor(opts: NlpClientOptions = {}) {
    this.url = (opts.url ?? "http://localhost:8000").replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.batchSize = opts.batchSize ?? 1000;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`NLP service unreachable at ${this.url} (${String(e)})`, { cause: e });
    }
    if (!res.ok) throw new Error(`NLP ${path}: HTTP ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  private async postForm<T>(path: string, form: FormData): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}${path}`, { method: "POST", body: form });
    } catch (e) {
      throw new Error(`NLP service unreachable at ${this.url} (${String(e)})`, { cause: e });
    }
    if (!res.ok) throw new Error(`NLP ${path}: HTTP ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
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

  async health(): Promise<{ status: string; version: string }> {
    const res = await this.fetchImpl(`${this.url}/health`);
    return (await res.json()) as { status: string; version: string };
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

  /** Short English glosses for words. Rejects with HTTP 503 if the dictionary is not built. */
  gloss(lang: NlpLang, words: string[]): Promise<GlossResult> {
    return this.post("/gloss", { lang, words });
  }
}
