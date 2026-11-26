/**
 * Plain-language errors. Transport errors from the language server (NLP) and
 * AnkiConnect arrive as technical strings, often through the server's RPC, so they are
 * recognised by their message rather than their class. Each becomes a cause the learner can
 * understand, one next step, and the original text as details.
 */

type ErrorSource = "nlp" | "anki" | "network" | "other";

export interface FriendlyError {
  /** What went wrong, in plain words. */
  message: string;
  /** The one thing to do next. */
  next?: string;
  /** Which part of the app failed; "nlp" and "anki" are fixed in Settings. */
  source: ErrorSource;
  /** The original technical message, for a details disclosure. */
  details?: string;
  /** Where the fix is (SY8: a message says where to go, with a button that goes there). */
  go?: SettingsPlace;
}

/** A Settings section, as a button's target and label. */
export type SettingsPlace = {
  section: "words" | "reading" | "devices" | "ai" | "data";
  label: string;
};
export const SETTINGS_PLACES = {
  words: { section: "words", label: "Your words" },
  devices: { section: "devices", label: "Your devices" },
  ai: { section: "ai", label: "AI" },
  data: { section: "data", label: "Data" },
  reading: { section: "reading", label: "Reading" },
} as const satisfies Record<string, SettingsPlace>;

const rawMessage = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : e == null ? "" : String(e);

/** True for messages that only make sense to a developer. */
const technical = (m: string) =>
  /HTTP \d{3}|not JSON|ECONN|fetch|TypeError|Error:|\/[a-z]+\/|\bat \w+ \(|[{}[\]]/i.test(m) ||
  m.length > 160;

/** Map any thrown value to a plain message, a next step and the technical details. */
export function describeError(e: unknown, fallback = "Something went wrong."): FriendlyError {
  const raw = rawMessage(e).trim();
  const details = raw || undefined;
  const withDetails = (f: Omit<FriendlyError, "details">): FriendlyError =>
    details ? { ...f, details } : f;

  if (raw.includes("no language server on this phone")) {
    return withDetails({
      source: "nlp",
      message: "On a phone, a new text is prepared by your server or your computer.",
      next: "Connect your server, or add the text on your computer: it comes here when you sync.",
      go: SETTINGS_PLACES.devices,
    });
  }
  if (/^NLP\b/.test(raw) || /NLP service/.test(raw)) {
    if (/no answer within/.test(raw)) {
      return withDetails({
        source: "nlp",
        message: "The language server took too long to answer.",
        next: "Long texts take a while; try again, or import a shorter part.",
      });
    }
    if (/unreachable|HTTP 50[234]/.test(raw)) {
      return withDetails({
        source: "nlp",
        message: "The language server is not reachable, so the text could not be analysed.",
        next: "Check that it is running and its address is right (Data → Advanced), then try again.",
        go: SETTINGS_PLACES.data,
      });
    }
    // The server said why in words ("The page could not be fetched (HTTP 404).", "The PDF is
    // password-protected."): show that, not a general line.
    const said = /^NLP \S+: HTTP 4\d\d (.{8,200})$/s.exec(raw)?.[1]?.trim();
    if (said && /^[A-Z][^{}<>]*[.!]$/.test(said)) {
      return withDetails({ source: "nlp", message: said, next: "Check it and try again." });
    }
    return withDetails({
      source: "nlp",
      message: "The language server could not process this.",
      next: "Try again. If it keeps failing, the details below help when reporting it.",
    });
  }
  if (/AnkiConnect|Anki is not reachable|Anki not reachable/.test(raw)) {
    if (/no answer within/.test(raw)) {
      return withDetails({
        source: "anki",
        go: SETTINGS_PLACES.words,
        message: "Anki did not answer in time.",
        next: "Close any open dialog in Anki, then try again.",
      });
    }
    if (/origin not allowed|forbidden|403/.test(raw)) {
      return withDetails({
        source: "anki",
        go: SETTINGS_PLACES.words,
        message: "Anki refused the connection from Vuurtoren.",
        next: "Allow this site in AnkiConnect's settings (webCorsOriginList) or set the API key in Settings.",
      });
    }
    if (/cannot reach|not reachable|HTTP 5\d\d|not JSON/.test(raw)) {
      return withDetails({
        source: "anki",
        go: SETTINGS_PLACES.words,
        message: "Anki is not reachable.",
        next: "Open Anki with the AnkiConnect add-on installed, then try again.",
      });
    }
    if (/API v1|Anki ≥/.test(raw)) {
      return withDetails({
        source: "anki",
        go: SETTINGS_PLACES.words,
        message: "This needs a newer Anki and AnkiConnect.",
        next: "Update Anki and the AnkiConnect add-on, then try again.",
      });
    }
    return withDetails({
      source: "anki",
      go: SETTINGS_PLACES.words,
      message: "Anki could not do this.",
      next: "Check Anki for a message, then try again.",
    });
  }
  if (/Failed to fetch|NetworkError|Load failed|network error/i.test(raw)) {
    return withDetails({
      source: "network",
      message: "Vuurtoren could not reach its server.",
      next: "Check your connection, then try again.",
    });
  }
  if (raw && !technical(raw)) return { source: "other", message: raw };
  return withDetails({ source: "other", message: fallback, next: "Try again." });
}

/** One line for a toast: the message and the next step. */
export function errorText(e: unknown, fallback?: string): string {
  const f = describeError(e, fallback);
  return f.next ? `${f.message} ${f.next}` : f.message;
}
