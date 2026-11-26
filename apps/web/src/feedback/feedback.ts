/**
 * The feedback button (FB1): what goes with a report, sending it to issue.vuurtoren.app, keeping
 * it on the device until it's sent, and Pavlo's replies. The sheet and the panel are in
 * FeedbackSheet.tsx; the Worker is server/feedback.
 */
import { appVersionLabel } from "../version.js";

/** Where reports go, and the key built into this app (README of server/feedback). */
const urlBase = () =>
  (import.meta.env["VITE_FEEDBACK_URL"] as string | undefined) ?? "https://issue.vuurtoren.app";
const key = () => (import.meta.env["VITE_FEEDBACK_KEY"] as string | undefined) ?? "";

/** No key in this build: no feedback button. */
export const feedbackOn = (): boolean => key().length > 0;

/** A test build shows the tab on the screen's edge (VITE_TEST_BUILD=1). */
export const testBuild = (): boolean => import.meta.env["VITE_TEST_BUILD"] === "1";

export interface Report {
  id: string;
  text: string;
  version: string;
  device: string;
  kind: "phone" | "computer";
  screen: string;
  errors: string[];
  picked?: string;
  /** This device's conversation (FB2): Pavlo's answers come back to it. */
  replyTo?: string;
  /** The name the tester gave once, for their topic in Pavlo's Telegram. */
  name?: string;
}

export interface Files {
  screenshot?: Blob | null;
  voice?: Blob | null;
}

// --- the last errors, so a report carries them without the tester copying anything ---

const ERRORS_KEPT = 5;
const recent: string[] = [];

/** An error the user saw (ErrorNotice) or one the page threw. */
export function recordError(text: string): void {
  const t = text.trim().slice(0, 300);
  if (!t || recent[0] === t) return;
  recent.unshift(t);
  recent.length = Math.min(recent.length, ERRORS_KEPT);
}

export const recentErrors = (): string[] => [...recent];

if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => recordError(String(e.message ?? "")));
  window.addEventListener("unhandledrejection", (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    recordError(r instanceof Error ? r.message : String(r ?? ""));
  });
}

// --- device facts ---

/** "Android 15, Pixel 8", "Linux, desktop app", "Firefox on Windows". */
export function deviceLine(userAgent: string, kind: "android" | "desktop" | "browser"): string {
  const version = /Android ([\d.]+)/.exec(userAgent)?.[1];
  if (kind === "android" || version) {
    // The model, as Connect a phone reads it (sync/connect.ts pairedLabel).
    const model = /Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/
      .exec(userAgent)?.[1]
      ?.trim();
    return `Android ${version ?? ""}${model && model !== "K" ? `, ${model}` : ""}`.trim();
  }
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Mac OS X|Macintosh/.test(userAgent)
      ? "macOS"
      : /Linux/.test(userAgent)
        ? "Linux"
        : "unknown system";
  if (kind === "desktop") return `${os}, desktop app`;
  const browser = /Firefox\//.test(userAgent)
    ? "Firefox"
    : /Edg\//.test(userAgent)
      ? "Edge"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "a browser";
  return `${browser} on ${os}`;
}

const randomId = (prefix: string) =>
  `${prefix}-${[...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

/** A new report with everything the app knows filled in. */
export function newReport(opts: {
  text: string;
  screen: string;
  kind: "android" | "desktop" | "browser";
  userAgent: string;
  picked?: string | undefined;
  error?: string | undefined;
}): Report {
  const name = feedbackName();
  const errors = recentErrors();
  if (opts.error && errors[0] !== opts.error) errors.unshift(opts.error.slice(0, 300));
  return {
    id: randomId("r"),
    text: opts.text.trim(),
    version: appVersionLabel(),
    device: deviceLine(opts.userAgent, opts.kind),
    kind: opts.kind === "android" ? "phone" : "computer",
    screen: opts.screen,
    errors: errors.slice(0, ERRORS_KEPT),
    ...(opts.picked ? { picked: opts.picked } : {}),
    replyTo: replyId(),
    ...(name ? { name } : {}),
  };
}

// --- the conversation (FB2): one random id per device, what was sent and the answers ---

const REPLY_ID = "vuurtoren.feedback.replyId";
const REPLIES = "vuurtoren.feedback.replies";
const MINE = "vuurtoren.feedback.mine";
const NAME = "vuurtoren.feedback.name";

/** The name the tester gave (Settings → Feedback), or "". */
export function feedbackName(): string {
  try {
    return localStorage.getItem(NAME) ?? "";
  } catch {
    return "";
  }
}

export function setFeedbackName(name: string): void {
  try {
    const n = name.trim().slice(0, 60);
    if (n) localStorage.setItem(NAME, n);
    else localStorage.removeItem(NAME);
  } catch {
    // Blocked storage: the reports go without a name.
  }
}

/** What the tester sent, as it shows in the conversation. */
export interface Mine {
  id: string;
  text: string;
  at: number;
  /** "Android 15, Pixel 8 · 26l · Read". */
  facts: string;
  picture: boolean;
  voice: boolean;
}

export function savedMine(): Mine[] {
  try {
    return JSON.parse(localStorage.getItem(MINE) ?? "[]") as Mine[];
  } catch {
    return [];
  }
}

/** Keep a sent (or kept-for-later) report for the conversation. */
export function rememberSent(
  report: Report,
  files: { picture: boolean; voice: boolean },
  screenName: string,
): void {
  const m: Mine = {
    id: report.id,
    text: report.text,
    at: Date.now(),
    facts: [report.device, report.version, screenName].filter(Boolean).join(" · "),
    ...files,
  };
  try {
    localStorage.setItem(
      MINE,
      JSON.stringify([...savedMine().filter((x) => x.id !== m.id), m].slice(-100)),
    );
  } catch {
    // Storage full or blocked: the report still goes; it just won't show here.
  }
}

export type Message = ({ who: "me" } & Mine) | ({ who: "pavlo" } & Reply);

/** The tester's messages and Pavlo's answers, oldest first. */
export function conversation(): Message[] {
  return [
    ...savedMine().map((m) => ({ who: "me" as const, ...m })),
    ...savedReplies().map((r) => ({ who: "pavlo" as const, ...r })),
  ].sort((a, b) => a.at - b.at);
}

function replyId(): string {
  try {
    const have = localStorage.getItem(REPLY_ID);
    if (have) return have;
    const made = randomId("d");
    localStorage.setItem(REPLY_ID, made);
    return made;
  } catch {
    return randomId("d");
  }
}

export interface Reply {
  report: string;
  text: string;
  at: number;
  read?: boolean;
}

export function savedReplies(): Reply[] {
  try {
    return JSON.parse(localStorage.getItem(REPLIES) ?? "[]") as Reply[];
  } catch {
    return [];
  }
}

function saveReplies(all: Reply[]): void {
  try {
    localStorage.setItem(REPLIES, JSON.stringify(all.slice(-100)));
  } catch {
    // Storage full or blocked: the replies show once and are gone.
  }
}

export function markRepliesRead(): void {
  saveReplies(savedReplies().map((r) => ({ ...r, read: true })));
}

/** New answers from Pavlo to this device. */
export async function fetchReplies(fetchImpl: typeof fetch = fetch): Promise<Reply[]> {
  if (!feedbackOn()) return [];
  let id: string | null;
  try {
    id = localStorage.getItem(REPLY_ID);
  } catch {
    return [];
  }
  if (!id) return [];
  const res = await fetchImpl(`${urlBase()}/v1/replies?to=${encodeURIComponent(id)}`, {
    headers: { "x-vuurtoren-key": key() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const { replies = [] } = (await res.json()) as { replies?: Reply[] };
  if (replies.length) saveReplies([...savedReplies(), ...replies]);
  return replies;
}

// --- sending, and the queue for when it can't be sent yet ---

/** Send one report; throws with a plain reason when the Worker says no. */
export async function sendReport(
  report: Report,
  files: Files,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const form = new FormData();
  form.set("report", JSON.stringify(report));
  if (files.screenshot) form.set("screenshot", files.screenshot, "screen.jpg");
  if (files.voice) {
    const ext = files.voice.type.includes("ogg")
      ? "ogg"
      : files.voice.type.includes("mp4")
        ? "m4a"
        : "webm";
    form.set("voice", files.voice, `voice.${ext}`);
  }
  const res = await fetchImpl(`${urlBase()}/v1/report`, {
    method: "POST",
    headers: { "x-vuurtoren-key": key() },
    body: form,
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    const why = error ?? `The feedback server answered ${res.status}.`;
    // Only a real no (bad report, wrong key, too big) is final; a server problem or the hourly
    // limit (5xx, 429) keeps the report for later.
    if ([400, 401, 413].includes(res.status)) throw new SendRefused(why);
    throw new Error(why);
  }
}

/** The Worker said no (too big, too many): retrying won't help. */
export class SendRefused extends Error {}

const DB = "vuurtoren-feedback";
const STORE = "queue";

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "report.id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueOp<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openQueue();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface Queued {
  report: Report;
  screenshot?: Blob | null;
  voice?: Blob | null;
}

/**
 * Send now; offline (or the server is away), keep it on the device and say so. Returns "sent" or
 * "kept". A refusal (too big, too many) is thrown, not kept.
 */
export async function submit(
  report: Report,
  files: Files,
  fetchImpl: typeof fetch = fetch,
): Promise<"sent" | "kept"> {
  try {
    await sendReport(report, files, fetchImpl);
    return "sent";
  } catch (e) {
    if (e instanceof SendRefused) throw e;
    try {
      await queueOp("readwrite", (s) =>
        s.put({
          report,
          screenshot: files.screenshot ?? null,
          voice: files.voice ?? null,
        } satisfies Queued),
      );
      return "kept";
    } catch {
      throw new Error(
        "It couldn't be sent, and this device can't keep it for later. Try again when you're online.",
        { cause: e },
      );
    }
  }
}

/** Send what was kept (at start and when the device comes online). */
export async function flushQueue(fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!feedbackOn() || typeof indexedDB === "undefined") return 0;
  let kept: Queued[];
  try {
    kept = await queueOp("readonly", (s) => s.getAll() as IDBRequest<Queued[]>);
  } catch {
    return 0;
  }
  let sent = 0;
  for (const q of kept) {
    try {
      await sendReport(
        q.report,
        { screenshot: q.screenshot ?? null, voice: q.voice ?? null },
        fetchImpl,
      );
    } catch (e) {
      if (!(e instanceof SendRefused)) break; // still offline: try later
    }
    await queueOp("readwrite", (s) => s.delete(q.report.id)).catch(() => undefined);
    sent++;
  }
  return sent;
}
