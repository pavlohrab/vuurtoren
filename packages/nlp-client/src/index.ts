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
}
