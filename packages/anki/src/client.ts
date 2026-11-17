/**
 * AnkiConnect client. The legacy action API (version 6) is the stable baseline; the v1
 * JSON-RPC API (AnkiConnect ≥ 26.08) is probed and used opportunistically.
 * See docs/research/02-anki-integration.md.
 */

export interface AnkiConnectOptions {
  url?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export class AnkiConnectError extends Error {
  constructor(
    message: string,
    readonly action: string,
  ) {
    super(`AnkiConnect ${action}: ${message}`);
    this.name = "AnkiConnectError";
  }
}

export interface NoteInfo {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
  cards: number[];
}

export interface CardInfo {
  cardId: number;
  note: number;
  deckName: string;
  modelName: string;
  /** Days if positive; negative = seconds (cards in learning steps). */
  interval: number;
  /** 0 new, 1 learning, 2 review, 3 relearning */
  type: number;
  /** -1 suspended, -2/-3 buried, 0 new, 1 learning, 2 review, 3 day-learn */
  queue: number;
  reps: number;
  lapses: number;
  mod?: number;
}

const CHUNK = 500;

export class AnkiConnectClient {
  readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnkiConnectOptions = {}) {
    this.url = (opts.url ?? "http://127.0.0.1:8765").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Call a legacy (version 6) action. */
  async invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const body: Record<string, unknown> = { action, version: 6, params };
    if (this.apiKey) body["key"] = this.apiKey;
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, { method: "POST", body: JSON.stringify(body) });
    } catch (e) {
      throw new AnkiConnectError(
        `cannot reach ${this.url} (is Anki running with AnkiConnect?) ${String(e)}`,
        action,
      );
    }
    if (res.status === 403)
      throw new AnkiConnectError("origin not allowed (webCorsOriginList / apiKey)", action);
    const json = (await res.json()) as { result: T; error: string | null };
    if (json.error) throw new AnkiConnectError(json.error, action);
    return json.result;
  }

  /** Call a v1 JSON-RPC method. */
  async rpc<T>(method: string, params: unknown = {}): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const res = await this.fetchImpl(`${this.url}/api/v1`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new AnkiConnectError(`HTTP ${res.status}`, method);
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new AnkiConnectError(json.error.message, method);
    return json.result as T;
  }

  version(): Promise<number> {
    return this.invoke<number>("version");
  }

  /** True if the v1 JSON-RPC API answers. */
  async hasV1(): Promise<boolean> {
    try {
      await this.rpc("api.describe");
      return true;
    } catch {
      return false;
    }
  }

  deckNames(): Promise<string[]> {
    return this.invoke<string[]>("deckNames");
  }

  findNotes(query: string): Promise<number[]> {
    return this.invoke<number[]>("findNotes", { query });
  }

  async notesInfo(notes: number[]): Promise<NoteInfo[]> {
    const out: NoteInfo[] = [];
    for (let i = 0; i < notes.length; i += CHUNK) {
      out.push(
        ...(await this.invoke<NoteInfo[]>("notesInfo", { notes: notes.slice(i, i + CHUNK) })),
      );
    }
    return out;
  }

  async cardsInfo(cards: number[]): Promise<CardInfo[]> {
    const out: CardInfo[] = [];
    for (let i = 0; i < cards.length; i += CHUNK) {
      out.push(
        ...(await this.invoke<CardInfo[]>("cardsInfo", { cards: cards.slice(i, i + CHUNK) })),
      );
    }
    return out;
  }
}

/** Escape quotes, backslashes and wildcards for Anki's search syntax. */
export function ankiEscape(value: string): string {
  return value.replace(/[\\"*_]/g, (c) => `\\${c}`);
}

/** Quote a literal value for Anki's search syntax. */
export function ankiQuote(value: string): string {
  return `"${ankiEscape(value)}"`;
}

/** Query for notes in exactly this deck (not its subdecks). */
export function exactDeckQuery(deck: string): string {
  const d = ankiEscape(deck);
  return `"deck:${d}" -"deck:${d}::*"`;
}
