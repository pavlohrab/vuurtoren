import { Check } from "lucide-react";
import { errorText } from "../../services/errors.js";
import type { SaveStatus } from "./useAutosave.js";

/** The quiet autosave indicator: "Saving…", "Saved", or what went wrong. */
export function SavedNote({ status, error }: { status: SaveStatus; error?: unknown }) {
  return (
    <span className="saved-note" role="status" aria-live="polite" data-status={status}>
      {status === "saving" ? (
        "Saving…"
      ) : status === "saved" ? (
        <>
          <Check size={14} aria-hidden /> Saved
        </>
      ) : status === "error" ? (
        `Not saved: ${errorText(error)}`
      ) : null}
    </span>
  );
}
