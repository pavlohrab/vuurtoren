/**
 * What a report can carry besides words: a picture of the screen (or of one thing on it, from
 * "Point at it") and a voice note (MediaRecorder).
 */
import { domToBlob } from "modern-screenshot";

/** The Worker takes pictures up to 3 MB (server/feedback LIMITS); stay under it. */
const MAX_BYTES = 2.8 * 1024 * 1024;

/**
 * The picture is drawn from a copy of the page, and in a copy every scrolled area (the reader,
 * a word list, the card) starts at its top again. So the scrolled areas are marked with where
 * they stand, and in the copy their content is moved by as much: the picture shows what the
 * person saw.
 */
function keepScroll(root: Element): () => void {
  const marked: Element[] = [];
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (el.scrollTop || el.scrollLeft) {
      el.setAttribute("data-fb-scroll", `${el.scrollLeft},${el.scrollTop}`);
      marked.push(el);
    }
  }
  return () => marked.forEach((el) => el.removeAttribute("data-fb-scroll"));
}

function moveScrolled(cloned: Node): void {
  if (!(cloned instanceof Element)) return;
  const areas = [
    ...(cloned.hasAttribute("data-fb-scroll") ? [cloned] : []),
    ...cloned.querySelectorAll("[data-fb-scroll]"),
  ];
  for (const area of areas) {
    const [left, top] = (area.getAttribute("data-fb-scroll") ?? "0,0").split(",").map(Number);
    (area as HTMLElement).style.overflow = "hidden";
    for (const child of area.children)
      (child as HTMLElement).style.transform = `translate(${-(left ?? 0)}px, ${-(top ?? 0)}px)`;
  }
}

/** One element as a JPEG under the size limit, scrolled areas as they stand. */
async function picture(node: Element, base: number): Promise<Blob | null> {
  const unmark = keepScroll(node);
  try {
    for (const [scale, quality] of [
      [base, 0.85],
      [Math.min(base, 1), 0.75],
      [Math.min(base, 0.7), 0.65],
    ] as const) {
      const blob = await domToBlob(node, {
        scale,
        type: "image/jpeg",
        quality,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        // The sheet and toasts are not part of what went wrong.
        filter: (n) => !(n instanceof HTMLElement && n.dataset["feedbackSkip"] !== undefined),
        onCloneNode: moveScrolled,
      });
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    return null;
  } catch {
    return null;
  } finally {
    unmark();
  }
}

/** The page as the person sees it: at most 2000 px wide. Null when it can't be taken. */
export function screenshot(node: HTMLElement = document.body): Promise<Blob | null> {
  return picture(
    node,
    Math.min(2, window.devicePixelRatio || 1, 2000 / Math.max(1, window.innerWidth)),
  );
}

/**
 * "Point at it": a picture of the picked thing with some room around it (its nearest ancestor
 * of a useful size), taken directly, with the thing in a red outline.
 */
export async function pictureAround(el: Element): Promise<Blob | null> {
  let area: Element = el;
  const roomy = (e: Element) => {
    const r = e.getBoundingClientRect();
    return r.width >= 320 && r.height >= 160;
  };
  while (!roomy(area) && area.parentElement && area.parentElement !== document.body)
    area = area.parentElement;
  const whole = await picture(area, Math.min(2, window.devicePixelRatio || 1));
  if (!whole) return null;
  try {
    const img = await createImageBitmap(whole);
    const box = area.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const scale = img.width / Math.max(1, box.width);
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    if (!g) return whole;
    g.drawImage(img, 0, 0);
    g.strokeStyle = "#b5432e";
    g.lineWidth = 3 * scale;
    g.setLineDash([8 * scale, 6 * scale]);
    g.strokeRect(
      (r.left - box.left - 4) * scale,
      (r.top - box.top - 4) * scale,
      (r.width + 8) * scale,
      (r.height + 8) * scale,
    );
    return await new Promise((ok) => c.toBlob((b) => ok(b ?? whole), "image/jpeg", 0.85));
  } catch {
    return whole;
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

const MAX_VOICE_MS = 60_000;

export const canRecord = (): boolean =>
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== "undefined";

export async function record(onLimit: () => void): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // Formats Telegram plays first (OGG/Opus as a voice message, M4A as audio); WebM last, which
  // reaches Pavlo only as a file.
  const type = [
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
  ].find((t) => MediaRecorder.isTypeSupported(t));
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
