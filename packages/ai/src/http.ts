import { AIError, type FetchLike } from "./types.js";

/** POST JSON and return the parsed body, mapping failures to AIError kinds. */
export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    // fetch() rejects with a bare TypeError for network failures and for blocked CORS alike.
    throw new AIError(
      `Could not reach ${new URL(url).host}. Check the address, your connection and (for local servers) that CORS is allowed for this site.`,
      "cors",
    );
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      const m = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message);
      if (m) detail = m;
    } catch {
      /* keep raw text */
    }
    const kind =
      res.status === 401 || res.status === 403
        ? "auth"
        : res.status === 429
          ? "rate-limit"
          : res.status >= 500
            ? "server"
            : "bad-request";
    throw new AIError(`${res.status}: ${detail}`, kind, res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError("The provider answered with something that is not JSON.", "server");
  }
}
