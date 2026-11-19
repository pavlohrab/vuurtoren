/** Why a sync place did not answer as expected, in words Settings can show. */
export class SyncPlaceError extends Error {
  override readonly name = "SyncPlaceError";
  constructor(
    message: string,
    /** offline: unreachable; auth: credentials refused; other: anything else. */
    readonly kind: "offline" | "auth" | "other" = "other",
  ) {
    super(message);
  }
}

/** A readable error from a failed response (a JSON `error`/`message`, or the status). */
export async function readError(res: Response): Promise<SyncPlaceError> {
  let detail = "";
  try {
    const text = await res.text();
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    detail = String(parsed.error ?? parsed.message ?? "");
  } catch {
    // Not JSON: the status says enough.
  }
  return new SyncPlaceError(
    detail ? `The sync place answered: ${detail}` : `The sync place answered ${res.status}.`,
  );
}
