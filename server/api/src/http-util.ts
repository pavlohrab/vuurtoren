/** Small HTTP helpers shared by the API routes and the auth module. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

/** An error that becomes an HTTP answer `{ ok: false, error }`. */
export class HttpFail extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Send JSON (never cached). */
export function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

/** Read a request body up to `limit` bytes (413 beyond). */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpFail(413, "Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Read and parse a JSON body (400 when it is not JSON). */
export async function readJson<T>(req: IncomingMessage, limit: number): Promise<T> {
  const raw = await readBody(req, limit);
  try {
    return JSON.parse(raw.toString("utf8")) as T;
  } catch {
    throw new HttpFail(400, "Body must be JSON.");
  }
}

/**
 * Constant-time string comparison. Both sides are hashed first, so neither the content nor
 * the length of the secret leaks through timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}
