/**
 * The wire contract between the HTTP repository (browser) and the API service (server):
 * which repository methods may be called remotely, with what arguments, and how results are
 * made JSON-safe. Pure and engine-free; imported by both sides.
 *
 * Only the methods listed here are callable. There is deliberately no way to send SQL.
 * `rebuild` is not remotely callable (the server rebuilds on its own when projections change).
 */
import { EVENT_TYPES } from "./types.js";

/** Largest event `append` accepts over RPC (serialised JSON, in UTF-16 code units). */
export const MAX_RPC_EVENT_CHARS = 24 * 1024 * 1024;

/** Most keys or ids one batched call (`wordsByKeys`, `getTexts`) accepts. */
export const MAX_RPC_BATCH = 20_000;

/** Argument kinds; a trailing "?" marks an optional argument. */
type ArgKind =
  "string" | "number" | "object" | "string[]" | "number[]" | "string?" | "number?" | "object?";

/** Allow-list of remotely callable repository methods and their argument kinds. */
export const RPC_METHODS = {
  append: ["object"],
  listTexts: [],
  getText: ["string"],
  getTexts: ["string[]"],
  learnerModel: ["string"],
  word: ["string", "string"],
  wordsByKeys: ["string", "string[]"],
  words: ["string", "object?"],
  staircase: ["string"],
  practiceItems: ["string"],
  practiceLog: ["string", "number"],
  activity: ["number"],
  textGrammar: ["string"],
  allTextGrammar: [],
  setting: ["string"],
  languageProfile: ["string"],
  events: ["string?"],
  lookedUpKeys: ["string", "string"],
  lastSnapshot: ["string"],
  eventCount: [],
  head: [],
  courses: [],
  courseBlocks: ["string"],
  unitExercises: ["string", "number"],
  unitWords: ["string", "number"],
  generatedUnitExercises: ["string", "number"],
  bookAnswers: ["string", "number?"],
  conversationEvents: [],
  generatedSentences: ["string"],
  examAttempts: ["string"],
  suggestedWords: ["string"],
  shelves: [],
  nativeDecks: ["string", "number"],
  nativeQueue: ["string", "number", "number", "number"],
  nativeCard: ["string", "number"],
  nativeDueKeys: ["string", "number", "number"],
  nativeCardReviews: ["string", "number[]"],
  nativeLastReview: ["string"],
  nativeDueCounts: ["string", "number", "number"],
  nativeReviews: ["string"],
  nativeCollection: ["string", "string[]"],
  nativeStats: ["string"],
  fsrsParams: ["string"],
  nativeMedia: ["string", "string[]"],
  nativeNoteStatus: ["string", "number[]", "number"],
} as const satisfies Record<string, readonly ArgKind[]>;

export type RpcMethod = keyof typeof RPC_METHODS;

/** Request body of `POST /api/rpc`. */
export interface RpcRequest {
  method: string;
  args?: unknown;
}

/** Response body of `POST /api/rpc`: `result` is omitted when the method returned undefined. */
export type RpcResponse = { ok: true; result?: unknown } | { ok: false; error: string };

/** True if `name` is an allow-listed method. */
export function isRpcMethod(name: unknown): name is RpcMethod {
  return typeof name === "string" && Object.hasOwn(RPC_METHODS, name);
}

/**
 * Check `args` against the method's signature.
 * @returns an error message, or null when the call is well formed
 */
export function validateRpcArgs(method: RpcMethod, args: unknown): string | null {
  if (!Array.isArray(args)) return "args must be an array";
  const kinds: readonly ArgKind[] = RPC_METHODS[method];
  if (args.length > kinds.length) return `${method} takes at most ${kinds.length} arguments`;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i] as ArgKind;
    const optional = kind.endsWith("?");
    const base = optional ? kind.slice(0, -1) : kind;
    const v: unknown = args[i];
    if (v === undefined || v === null) {
      if (optional) continue;
      return `${method}: argument ${i + 1} is required`;
    }
    if (base === "string[]" || base === "number[]") {
      const item = base === "string[]" ? "string" : "number";
      if (!Array.isArray(v) || v.some((x) => typeof x !== item)) {
        return `${method}: argument ${i + 1} must be an array of ${item}s`;
      }
      if (v.length > MAX_RPC_BATCH) return `${method}: at most ${MAX_RPC_BATCH} items per call`;
      continue;
    }
    const ok = base === "object" ? typeof v === "object" && !Array.isArray(v) : typeof v === base;
    if (!ok) return `${method}: argument ${i + 1} must be a ${base}`;
  }
  if (method === "append") return validateEvent(args[0]);
  return null;
}

/** Shape check for an appended event: a known type and a bounded size. */
function validateEvent(event: unknown): string | null {
  const type = (event as { type?: unknown }).type;
  if (typeof type !== "string" || !EVENT_TYPES.has(type)) return "append: unknown event type";
  let size: number;
  try {
    size = JSON.stringify(event).length;
  } catch {
    return "append: event is not JSON";
  }
  if (size > MAX_RPC_EVENT_CHARS) return "append: event is too large";
  return null;
}

/** Make a result JSON-safe: a Map (the learner model) travels as an array of entries. */
export function encodeRpcResult(value: unknown): unknown {
  return value instanceof Map ? [...value] : value;
}
