/**
 * HTTP repository ("@app/db/http"): the `KenningRepository` contract over the API service
 * (server/api), for the self-hosted "one SQLite file on the server" mode. Same method names
 * and arguments as the local repository; results are JSON, with the learner model's Map
 * rebuilt from entries. No Node APIs: runs in the browser and in tests.
 */
import { type DataAdmin, type DataInfo, backupFilename, checkBackupHeader } from "./backup.js";
import type { KenningRepository } from "./repository.js";
import { type RpcMethod, type RpcResponse } from "./rpc.js";
import type { WordKnowledge } from "@app/core";

export { backupFilename };

/** Body of `GET /api/health` (never requires authentication). */
export interface ServerHealth {
  ok: true;
  service: "kenning-api";
  /** "ready", or "schema-too-new" when the stored database needs a newer app. */
  state: "ready" | "schema-too-new";
  /** True when requests need a sign-in session (cookie) or `Authorization: Bearer <token>`. */
  authRequired: boolean;
  /** How one can sign in (absent on servers older than ADR 0009: token only). */
  authMethods?: ("password" | "token")[];
  schemaVersion: number;
  /** Schema version found in the file when `state` is "schema-too-new". */
  foundVersion?: number;
}

/** A failed API call. `status` is the HTTP status (401 = sign-in needed or token wrong). */
export class HttpError extends Error {
  override readonly name = "HttpError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type FetchLike = typeof fetch;

/** Wrap the ambient `fetch` lazily (keeps `this` bound and lets tests stub it). */
const ambientFetch: FetchLike = (...args) => globalThis.fetch(...args);

/**
 * Ask a same-origin (or given) base URL whether a Kenning API answers. Any other answer
 * (404, an HTML page from a SPA fallback, a network error, a timeout) returns null.
 */
export async function fetchServerHealth(
  baseUrl: string = "",
  fetchImpl: FetchLike = ambientFetch,
  timeoutMs: number = 2000,
): Promise<ServerHealth | null> {
  try {
    const res = await fetchImpl(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<ServerHealth> | null;
    return body && body.ok === true && body.service === "kenning-api"
      ? (body as ServerHealth)
      : null;
  } catch {
    return null;
  }
}

/** Read the error message of a failed response (JSON `{error}` or plain text). */
async function failure(res: Response): Promise<HttpError> {
  let message = `Server answered ${res.status}`;
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      if (text && text.length < 300) message = text;
    }
  } catch {
    /* keep the generic message */
  }
  return new HttpError(message, res.status);
}

/**
 * Backup/restore and stats over HTTP. Works even when the server's database is too new for
 * the repository (export stays available so the user can save their data).
 */
export function createHttpAdmin(
  baseUrl: string = "",
  token?: string,
  fetchImpl: FetchLike = ambientFetch,
): DataAdmin {
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...extra,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  return {
    async info(): Promise<DataInfo> {
      const res = await fetchImpl(`${baseUrl}/api/info`, { headers: headers() });
      if (!res.ok) throw await failure(res);
      return (await res.json()) as DataInfo;
    },
    async exportBackup(): Promise<Uint8Array> {
      const res = await fetchImpl(`${baseUrl}/api/export`, { headers: headers() });
      if (!res.ok) throw await failure(res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async importBackup(bytes: Uint8Array): Promise<void> {
      checkBackupHeader(bytes); // fail fast, before uploading a large wrong file
      const res = await fetchImpl(`${baseUrl}/api/import`, {
        method: "POST",
        // X-Kenning marks a deliberate request from the app (the server's CSRF guard).
        headers: headers({ "content-type": "application/octet-stream", "x-kenning": "1" }),
        body: bytes as BodyInit,
      });
      if (!res.ok) throw await failure(res);
    },
  };
}

/** A repository backed by the API service, plus its backup/restore surface. */
export type HttpRepository = KenningRepository & DataAdmin;

/**
 * Connect to the API service. Fetches the server's device id once (this verifies the token:
 * a wrong or missing one rejects with `HttpError` status 401).
 *
 * @param baseUrl "" for same origin, or e.g. "http://127.0.0.1:8787"
 * @param token bearer token when the server requires one
 *
 * @example
 * const repo = await createHttpRepository("", localStorage.getItem("kenning-token") ?? undefined);
 */
export async function createHttpRepository(
  baseUrl: string = "",
  token?: string,
  fetchImpl: FetchLike = ambientFetch,
): Promise<HttpRepository> {
  const admin = createHttpAdmin(baseUrl, token, fetchImpl);
  const deviceId = (await admin.info()).deviceId ?? "server";

  /** Call one allow-listed method. */
  async function call<T>(method: RpcMethod, ...args: unknown[]): Promise<T> {
    // Trailing undefined arguments are dropped; an inner undefined becomes null (= absent).
    while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
    const res = await fetchImpl(`${baseUrl}/api/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ method, args }),
    });
    if (!res.ok) throw await failure(res);
    const body = (await res.json()) as RpcResponse;
    if (!body.ok) throw new HttpError(body.error, res.status);
    return body.result as T;
  }

  const repo: HttpRepository = {
    deviceId,
    append: (event) => call("append", event),
    listTexts: () => call("listTexts"),
    getText: (id) => call("getText", id),
    learnerModel: async (lang) =>
      new Map(await call<[string, WordKnowledge][]>("learnerModel", lang)),
    word: (lang, key) => call("word", lang, key),
    words: (lang, opts) => call("words", lang, opts),
    staircase: (lang) => call("staircase", lang),
    practiceItems: (lang) => call("practiceItems", lang),
    practiceLog: (lang, limit) => call("practiceLog", lang, limit),
    textGrammar: (textId) => call("textGrammar", textId),
    allTextGrammar: () => call("allTextGrammar"),
    setting: <T>(key: string) => call<T | undefined>("setting", key),
    languageProfile: (lang) => call("languageProfile", lang),
    rebuild: () => call("rebuild"),
    events: (sinceId) => call("events", sinceId),
    lookedUpKeys: (lang, textId) => call("lookedUpKeys", lang, textId),
    lastSnapshot: (lang) => call("lastSnapshot", lang),
    eventCount: () => call("eventCount"),
    courses: () => call("courses"),
    courseBlocks: (courseId) => call("courseBlocks", courseId),
    unitExercises: (courseId, unitN) => call("unitExercises", courseId, unitN),
    unitWords: (courseId, unitN) => call("unitWords", courseId, unitN),
    bookAnswers: (courseId, unitN) => call("bookAnswers", courseId, unitN),
    conversationEvents: () => call("conversationEvents"),
    generatedSentences: (lang) => call("generatedSentences", lang),
    // The server serialises every call already; nothing to lock on this side.
    exclusive: (fn) => fn(),
    close: () => Promise.resolve(),
    ...admin,
  };
  return repo;
}
