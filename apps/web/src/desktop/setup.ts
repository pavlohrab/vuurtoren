/**
 * Offline mode: what the first-run card says while the bundled language server starts and
 * installs its data packs (dictionary, example sentences, translation model), from its
 * `/health`. Pure, so the wording is tested without the app.
 */
import type { SidecarStatus } from "./bridge.js";

const PACK_NAMES: Record<string, string> = {
  "dictionary-nl": "the Dutch dictionary",
  "sentences-nl": "example sentences",
  "mt-nl-en": "the translation model",
  "grammar-examples-nl": "grammar examples",
};

/** Megabytes as people read them on a download page (decimal, whole numbers). */
export const mb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

export interface SetupView {
  tone: "progress" | "error";
  /** One calm sentence. */
  message: string;
  /** 0..1 for the current download, when known. */
  progress?: number;
  /** What the button does, if there is one. */
  action?: "restart" | "retry-packs";
}

/** Null when everything is ready (the card disappears). */
export function setupView(status: SidecarStatus | null | undefined): SetupView | null {
  if (!status) return null;
  switch (status.state) {
    case "idle":
    case "starting":
      return { tone: "progress", message: "Starting the language tools…" };
    case "missing":
      return {
        tone: "error",
        message:
          "This build of Kenning has no language tools, so texts are not analysed. Install the release from GitHub.",
      };
    case "failed":
      return {
        tone: "error",
        message: `The language tools could not start. ${status.error}`,
        action: "restart",
      };
    case "ready":
      break;
  }
  const items = Object.entries(status.health?.packs?.items ?? {});
  const failed = items.find(([, p]) => p.activity?.startsWith("error"));
  for (const [name, p] of items) {
    const what = PACK_NAMES[name] ?? name;
    if (p.activity === "downloading") {
      const size = p.size ?? 0;
      return {
        tone: "progress",
        message: `Downloading ${what}…${size ? ` ${mb(size)}` : ""}`,
        ...(size && p.received !== undefined ? { progress: Math.min(1, p.received / size) } : {}),
      };
    }
    if (p.activity === "installing") return { tone: "progress", message: `Installing ${what}…` };
    if (p.activity === "building") return { tone: "progress", message: `Preparing ${what}…` };
  }
  if (failed) {
    return {
      tone: "error",
      message: `Could not download ${PACK_NAMES[failed[0]] ?? failed[0]}. Check the internet connection and try again.`,
      action: "retry-packs",
    };
  }
  if (status.health?.packs?.busy) return { tone: "progress", message: "Getting the data ready…" };
  return null;
}

/** The language server is up but cannot read photos (no Tesseract in the desktop app). */
export function ocrAvailable(status: SidecarStatus | null | undefined): boolean {
  return status?.health?.ocr === true;
}
