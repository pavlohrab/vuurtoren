/** Small HTTP helpers shared by the API routes and the auth module. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { createWriteStream, rmSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

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

/**
 * Stream a request body into `file` without holding it in memory (413 beyond `limit` bytes).
 * The file is removed again when the upload fails.
 * @returns the number of bytes written
 */
export async function streamBodyToFile(
  req: IncomingMessage,
  file: string,
  limit: number,
): Promise<number> {
  let size = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      if (size > limit) done(new HttpFail(413, "Request body is too large."));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(req, cap, createWriteStream(file, { flags: "wx", mode: 0o600 }));
  } catch (err) {
    rmSync(file, { force: true });
    if (err instanceof HttpFail) throw err;
    throw new HttpFail(400, "The upload was interrupted.");
  }
  return size;
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
