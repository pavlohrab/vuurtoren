/**
 * What the feedback Worker decides, without Cloudflare: is a report valid, what Pavlo's Telegram
 * message says, and what the GitHub issue says. The handlers are in index.ts.
 */

/** What the app sends with each report (the `report` field, JSON). */
export interface Report {
  /** Made by the app, so a report sent twice (offline, then online) is stored once. */
  id: string;
  text: string;
  /** "26e (b7c1d68)" */
  version: string;
  /** "Android 15, Pixel 8" or "Linux AppImage" */
  device: string;
  /** "phone" | "computer" */
  kind: "phone" | "computer";
  /** The screen, as the app's path: "/read/t42". */
  screen: string;
  /** The last error messages, newest first, short. */
  errors: string[];
  /** Desktop "Point at it": the element's name. */
  picked?: string;
  /** A random id of this device for Pavlo's replies; absent when the tester said no. */
  replyTo?: string;
}

export const LIMITS = {
  text: 4000,
  errors: 5,
  errorLength: 300,
  screenshotBytes: 3 * 1024 * 1024,
  voiceBytes: 2 * 1024 * 1024,
  perHour: 10,
};

const ID = /^[a-z0-9-]{8,64}$/i;

/** The report as sent, checked and trimmed; a reason when it can't be taken. */
export function readReport(raw: unknown): { report: Report } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "No report." };
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const id = str(r.id, 64);
  if (!ID.test(id)) return { error: "No report id." };
  const text = str(r.text, LIMITS.text);
  const kind = r.kind === "computer" ? "computer" : "phone";
  const errors = Array.isArray(r.errors)
    ? r.errors
        .filter((e): e is string => typeof e === "string")
        .slice(0, LIMITS.errors)
        .map((e) => e.slice(0, LIMITS.errorLength))
    : [];
  const replyTo = str(r.replyTo, 64);
  const picked = str(r.picked, 200);
  return {
    report: {
      id,
      text,
      version: str(r.version, 60) || "unknown",
      device: str(r.device, 120) || "unknown",
      kind,
      screen: str(r.screen, 200) || "/",
      errors,
      ...(picked ? { picked } : {}),
      ...(ID.test(replyTo) ? { replyTo } : {}),
    },
  };
}

/** A report needs words, a voice note or a picture to be worth anything. */
export function hasContent(report: Report, files: { screenshot: boolean; voice: boolean }) {
  return report.text.length > 0 || files.voice || files.screenshot;
}

/** The screen's name from its path: "/read/t42" → "Read". */
export function screenName(path: string): string {
  const first = path.split(/[/?#]/).filter(Boolean)[0] ?? "";
  const names: Record<string, string> = {
    "": "Home",
    read: "Read",
    words: "Words",
    practice: "Practice",
    review: "Review",
    exam: "Exam",
    talk: "Talk",
    settings: "Settings",
    courses: "Courses",
    grammar: "Grammar",
    progress: "Progress",
    import: "Add text",
  };
  return names[first] ?? first;
}

/** The first line of Pavlo's message: "Phone · 26e · Read". */
export function headline(report: Report): string {
  const kind = report.kind === "computer" ? "Computer" : "Phone";
  const version = report.version.split(" ")[0];
  return `${kind} · ${version} · ${screenName(report.screen)}`;
}

/** Pavlo's Telegram message (plain text, at most 1024 characters for a photo caption). */
export function message(report: Report, transcript: string | null): string {
  const lines = [headline(report), ""];
  if (report.text) lines.push(report.text, "");
  if (transcript) lines.push(`🎙 ${transcript}`, "");
  if (report.picked) lines.push(`Pointed at: ${report.picked}`);
  lines.push(report.device);
  lines.push(report.errors.length ? `Last error: ${report.errors[0]}` : "No errors");
  if (report.replyTo) lines.push("Reply to this message to answer the tester.");
  const out = lines.join("\n");
  return out.length > 1024 ? `${out.slice(0, 1020)}…` : out;
}

/** A title for the issue: the first sentence or line of the text, short. */
export function issueTitle(report: Report, transcript: string | null): string {
  const source = report.text || transcript || `Feedback from ${headline(report)}`;
  const first = source.split(/\n|(?<=[.!?])\s/)[0]!.trim();
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
}

/** The issue's body: the words, then the facts in a block. No name, no email, no picture. */
export function issueBody(report: Report, transcript: string | null): string {
  const parts: string[] = [];
  if (report.text) parts.push(report.text);
  if (transcript) parts.push(`Voice note: ${transcript}`);
  const facts = [
    `Version: ${report.version}`,
    `Device: ${report.device}`,
    `Screen: ${report.screen}`,
    ...(report.picked ? [`Pointed at: ${report.picked}`] : []),
    `Errors: ${report.errors.length ? report.errors.join(" | ") : "none"}`,
  ];
  parts.push("```\n" + facts.join("\n") + "\n```");
  parts.push("_From a tester, through the feedback button._");
  return parts.join("\n\n");
}

/** Labels for the issue. */
export function issueLabels(report: Report): string[] {
  return ["from a tester", report.kind];
}

/** A short hash of the sender's address for the hourly limit (never the address itself). */
export async function addressHash(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const sum = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...sum.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
