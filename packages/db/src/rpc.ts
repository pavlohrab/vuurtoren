/**
 * The wire contract between the HTTP repository (browser) and the API service (server):
 * which repository methods may be called remotely, with what arguments, and how results are
 * made JSON-safe. Pure and engine-free; imported by both sides.
 *
 * Only the methods listed here are callable. There is deliberately no way to send SQL.
 */

/** Argument kinds; a trailing "?" marks an optional argument. */
type ArgKind = "string" | "number" | "object" | "string?" | "number?" | "object?";

/** Allow-list of remotely callable repository methods and their argument kinds. */
export const RPC_METHODS = {
  append: ["object"],
  listTexts: [],
  getText: ["string"],
  learnerModel: ["string"],
  word: ["string", "string"],
  words: ["string", "object?"],
  staircase: ["string"],
  practiceItems: ["string"],
  practiceLog: ["string", "number"],
  setting: ["string"],
  rebuild: [],
  events: ["string?"],
  lookedUpKeys: ["string", "string"],
  lastSnapshot: ["string"],
  eventCount: [],
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
    const ok = base === "object" ? typeof v === "object" && !Array.isArray(v) : typeof v === base;
    if (!ok) return `${method}: argument ${i + 1} must be a ${base}`;
  }
  return null;
}

/** Make a result JSON-safe: a Map (the learner model) travels as an array of entries. */
export function encodeRpcResult(value: unknown): unknown {
  return value instanceof Map ? [...value] : value;
}
