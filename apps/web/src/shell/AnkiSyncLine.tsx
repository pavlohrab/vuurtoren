/** The quiet line above every page while Kenning reads your Anki decks, or when that failed. */
import { useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "@app/ui";
import { useServices } from "../services/context.js";
import { clearAnkiSyncError, runAnkiSync, useAnkiSync } from "./ankiSync.js";

export function AnkiSyncLine() {
  const services = useServices();
  const qc = useQueryClient();
  const sync = useAnkiSync();
  if (!sync.running && !sync.error) return null;
  return (
    <div className="shell-notices">
      <div className="shell-notice" role="status" aria-live="polite">
        {sync.running ? <Spinner label="Importing from Anki" /> : null}
        <span className="shell-notice-text">
          {sync.running
            ? (sync.message ?? "Reading your Anki decks…")
            : `Your Anki decks could not be read: ${sync.error}`}
        </span>
        {sync.error ? (
          <>
            <Button size="sm" onClick={() => void runAnkiSync(services, qc).catch(() => undefined)}>
              Try again
            </Button>
            <button type="button" className="link-button" onClick={clearAnkiSyncError}>
              Dismiss
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
