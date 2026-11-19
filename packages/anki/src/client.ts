/**
 * AnkiConnect client. The legacy action API (version 6) is the stable baseline; the v1
 * JSON-RPC API (AnkiConnect ≥ 26.08) is probed and used opportunistically.
 *
 */

export interface AnkiConnectOptions {
  url?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  /** Per-request timeout in ms (default 30 s; Anki can block on a modal dialog). */
  timeoutMs?: number;
}

/**
 * What went wrong: `network` (fetch threw: Anki is down, or the browser blocked the response
 * because the origin is not allowed), `timeout`, `forbidden` (HTTP 403), `api` (AnkiConnect
 * returned an error string) or `parse` (not JSON).
 */
export type AnkiErrorKind = "network" | "timeout" | "forbidden" | "api" | "parse";

export class AnkiConnectError extends Error {
  constructor(
    message: string,
    readonly action: string,
    readonly kind: AnkiErrorKind = "api",
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
  private readonly timeoutMs: number;

  constructor(opts: AnkiConnectOptions = {}) {
    this.url = (opts.url ?? "http://127.0.0.1:8765").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** fetch with timeout; network errors and timeouts become AnkiConnectError. */
  private async send(url: string, init: RequestInit, action: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "TimeoutError";
      throw new AnkiConnectError(
        timedOut
          ? `no answer within ${this.timeoutMs / 1000}s (is a dialog open in Anki?)`
          : `cannot reach ${this.url} (is Anki running with AnkiConnect?) ${String(e)}`,
        action,
        timedOut ? "timeout" : "network",
      );
    }
  }

  private static async json<T>(res: Response, action: string): Promise<T> {
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AnkiConnectError(
        `HTTP ${res.status}, not JSON: ${text.slice(0, 120)}`,
        action,
        "parse",
      );
    }
  }

  /** Call a legacy (version 6) action. */
  async invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const body: Record<string, unknown> = { action, version: 6, params };
    if (this.apiKey) body["key"] = this.apiKey;
    const res = await this.send(this.url, { method: "POST", body: JSON.stringify(body) }, action);
    if (res.status === 403)
      throw new AnkiConnectError(
        "origin not allowed (webCorsOriginList / apiKey)",
        action,
        "forbidden",
      );
    const json = await AnkiConnectClient.json<{ result: T; error: string | null }>(res, action);
    if (json.error) throw new AnkiConnectError(json.error, action);
    return json.result;
  }

  /**
   * Run legacy actions through `multi`, in batches of 100, and say per action whether it
   * worked. Each action carries `version: 6` (and the API key when there is one, since
   * AnkiConnect checks it on every action).
   */
  async multi<T>(
    actions: { action: string; params: Record<string, unknown> }[],
  ): Promise<MultiReply<T>[]> {
    const out: MultiReply<T>[] = [];
    for (let i = 0; i < actions.length; i += MULTI_BATCH) {
      const chunk = actions.slice(i, i + MULTI_BATCH).map((a) => {
        const one: Record<string, unknown> = { ...a, version: 6 };
        if (this.apiKey) one["key"] = this.apiKey;
        return one;
      });
      const replies = (await this.invoke<unknown[] | null>("multi", { actions: chunk })) ?? [];
      chunk.forEach((_, j) => out.push(multiReply<T>(replies[j])));
    }
    return out;
  }

  /** Call a v1 JSON-RPC method. */
  async rpc<T>(method: string, params: unknown = {}): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const res = await this.send(
      `${this.url}/api/v1`,
      { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) },
      method,
    );
    if (!res.ok) throw new AnkiConnectError(`HTTP ${res.status}`, method);
    const json = await AnkiConnectClient.json<{ result?: T; error?: { message: string } }>(
      res,
      method,
    );
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
      // api.describe missing (older AnkiConnect): feature detection, not an error
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

  /** Last review time (ms since epoch) per card, from the review log (legacy getReviewsOfCards). */
  async lastReviews(cards: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    for (let i = 0; i < cards.length; i += CHUNK) {
      const res = await this.invoke<Record<string, { id: number }[]>>("getReviewsOfCards", {
        cards: cards.slice(i, i + CHUNK).map(String),
      });
      for (const [cardId, reviews] of Object.entries(res)) {
        // Review ids are millisecond timestamps.
        const last = reviews.reduce((m, r) => Math.max(m, r.id), 0);
        if (last > 0) out.set(Number(cardId), last);
      }
    }
    return out;
  }

  /** Send up to 100 v1 calls in one JSON-RPC batch request. */
  async rpcBatch<T>(calls: { method: string; params: unknown }[]): Promise<(T | null)[]> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const res = await this.send(
      `${this.url}/api/v1`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: "2.0", id, ...c }))),
      },
      "batch",
    );
    if (!res.ok) throw new AnkiConnectError(`HTTP ${res.status}`, "batch");
    const json = await AnkiConnectClient.json<unknown>(res, "batch");
    if (!Array.isArray(json)) {
      const msg =
        (json as { error?: { message?: string } } | null)?.error?.message ?? "not a batch response";
      throw new AnkiConnectError(msg, "batch");
    }
    const out: (T | null)[] = calls.map(() => null);
    for (const r of json as { id: number; result?: T; error?: unknown }[])
      if (r.error === undefined && r.result !== undefined) out[r.id] = r.result;
    return out;
  }

  /** FSRS memory per card via v1 scheduling.get (null where FSRS is off or the call failed). */
  async fsrsMemory(cards: number[]): Promise<Map<number, FsrsMemory | null>> {
    const out = new Map<number, FsrsMemory | null>();
    for (let i = 0; i < cards.length; i += RPC_BATCH) {
      const chunk = cards.slice(i, i + RPC_BATCH);
      const states = await this.rpcBatch<SchedulingState>(
        chunk.map((id) => ({ method: "scheduling.get", params: { cardId: String(id) } })),
      );
      chunk.forEach((id, j) => out.set(id, states[j]?.fsrsMemory ?? null));
    }
    return out;
  }
}

const RPC_BATCH = 100;
const MULTI_BATCH = 100;

/** One action's answer inside a `multi` reply. */
export type MultiReply<T> = { ok: true; result: T } | { ok: false; error: string };

/**
 * Read one item of a `multi` reply. Actions sent with `version: 6` answer `{ result, error }`;
 * older ones answer the plain value, or `{ error }` when they failed.
 */
function multiReply<T>(raw: unknown): MultiReply<T> {
  if (raw === undefined) return { ok: false, error: "no answer" };
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && "error" in raw) {
    const r = raw as { result?: unknown; error: unknown };
    if (r.error !== null && r.error !== undefined) return { ok: false, error: String(r.error) };
    if ("result" in r) return { ok: true, result: r.result as T };
  }
  return { ok: true, result: raw as T };
}

export interface FsrsMemory {
  difficulty: number;
  stabilityDays: number;
}

/** Subset of the v1 SchedulingState schema (AnkiConnect api.describe). */
export interface SchedulingState {
  type: "new" | "learning" | "review" | "relearning";
  intervalDays: number;
  fsrsMemory: FsrsMemory | null;
  desiredRetention: number | null;
}

/** Escape quotes, backslashes and wildcards for Anki's search syntax. */
export function ankiEscape(value: string): string {
  return value.replace(/[\\"*_]/g, (c) => `\\${c}`);
}

/** Query for notes in exactly this deck (not its subdecks). */
export function exactDeckQuery(deck: string): string {
  const d = ankiEscape(deck);
  return `"deck:${d}" -"deck:${d}::*"`;
}
