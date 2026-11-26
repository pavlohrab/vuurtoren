/**
 * What a report can carry besides words: a picture of the screen (or of one thing on it, from
 * "Point at it") and a voice note (MediaRecorder).
 */
import { domToBlob } from "modern-screenshot";

/** The Worker takes pictures up to 3 MB (server/feedback LIMITS); stay under it. */
const MAX_BYTES = 2.8 * 1024 * 1024;

/**
 * The page as a JPEG, taken before the sheet opens: at most 2000 px wide, and smaller again
 * when it's still too big. Null when it can't be taken (the report goes without it).
 */
export async function screenshot(node: HTMLElement = document.body): Promise<Blob | null> {
  const base = Math.min(2, window.devicePixelRatio || 1, 2000 / Math.max(1, window.innerWidth));
  for (const [scale, quality] of [
    [base, 0.85],
    [Math.min(base, 1), 0.75],
    [Math.min(base, 0.7), 0.65],
  ] as const) {
    try {
      const blob = await domToBlob(node, {
        scale,
        type: "image/jpeg",
        quality,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        // The sheet and toasts are not part of what went wrong.
        filter: (n) => !(n instanceof HTMLElement && n.dataset["feedbackSkip"] !== undefined),
      });
      if (blob && blob.size <= MAX_BYTES) return blob;
    } catch {
      return null;
    }
  }
  return null;
}

/** A picture of the window cut around one element, with room to see where it sits. */
export async function cropAround(whole: Blob, rect: DOMRect, margin = 80): Promise<Blob | null> {
  try {
    const img = await createImageBitmap(whole);
    const scale = img.width / window.innerWidth;
    const x = Math.max(0, (rect.left - margin) * scale);
    const y = Math.max(0, (rect.top - margin) * scale);
    const w = Math.min(img.width - x, (rect.width + margin * 2) * scale);
    const h = Math.min(img.height - y, (rect.height + margin * 2) * scale);
    const c = document.createElement("canvas");
    c.width = Math.round(w);
    c.height = Math.round(h);
    const g = c.getContext("2d");
    if (!g) return null;
    g.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
    // The picked thing in a red outline, as the tester saw it.
    g.strokeStyle = "#b5432e";
    g.lineWidth = 3 * scale;
    g.setLineDash([8 * scale, 6 * scale]);
    g.strokeRect(
      rect.left * scale - x - 4 * scale,
      rect.top * scale - y - 4 * scale,
      rect.width * scale + 8 * scale,
      rect.height * scale + 8 * scale,
    );
    return await new Promise((r) => c.toBlob((b) => r(b), "image/jpeg", 0.85));
  } catch {
    return null;
  }
}

/** A short name for a picked element: its label, its text, or its kind, and its class. */
export function describeElement(el: Element): string {
  const label =
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  const role = el.getAttribute("role") || el.tagName.toLowerCase();
  const cls = [...el.classList]
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join("");
  return `${label ? `"${label}" ` : ""}${role}${cls}`.slice(0, 200);
}

/** A voice note: start, stop (a Blob), the level for the bars, and a one-minute limit. */
export interface Recorder {
  stop(): Promise<Blob>;
  cancel(): void;
  /** 0–1, the loudness right now. */
  level(): number;
}

export const MAX_VOICE_MS = 60_000;

export const canRecord = (): boolean =>
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== "undefined";

export async function record(onLimit: () => void): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"].find(
    (t) => MediaRecorder.isTypeSupported(t),
  );
  const rec = new MediaRecorder(
    stream,
    type ? { mimeType: type, audioBitsPerSecond: 24_000 } : undefined,
  );
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const end = () => {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
  const limit = window.setTimeout(onLimit, MAX_VOICE_MS);
  rec.start(250);
  return {
    stop: () =>
      new Promise((resolve) => {
        window.clearTimeout(limit);
        rec.onstop = () => {
          end();
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        };
        rec.stop();
      }),
    cancel: () => {
      window.clearTimeout(limit);
      rec.onstop = end;
      rec.stop();
    },
    level: () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      return Math.min(1, peak / 64);
    },
  };
}
