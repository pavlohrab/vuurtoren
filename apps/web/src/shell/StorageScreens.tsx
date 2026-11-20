import { useState, type ReactNode } from "react";
import { Button } from "@app/ui";
import { downloadBytes } from "../screens/settings/DataSettings.js";
import { backupFilename } from "@app/db";

/** Full-page message used before the app can start (no router, no providers). */
function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main
      style={{
        maxWidth: 520,
        margin: "12vh auto",
        padding: "0 16px",
        display: "grid",
        gap: 16,
        color: "var(--ink)",
      }}
    >
      <h1 style={{ fontSize: 28 }}>{title}</h1>
      {children}
    </main>
  );
}

/** The stored database was written by a newer Vuurtoren: never fall back to demo data. */
export function BlockedScreen({
  message,
  download,
}: {
  message: string;
  download: () => Promise<Uint8Array>;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Page title="Your data needs a newer Vuurtoren">
      <p role="alert" style={{ margin: 0 }}>
        {message}
      </p>
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        Nothing was changed or deleted. Update Vuurtoren (pull the newest version and rebuild or
        redeploy it), then reload this page. You can save a copy of your data first.
      </p>
      <div className="row">
        <Button
          variant="primary"
          onClick={() => {
            setError(null);
            download().then(
              (bytes) => downloadBytes(bytes, backupFilename()),
              (e: unknown) => setError(e instanceof Error ? e.message : "Could not export."),
            );
          }}
        >
          Download backup
        </Button>
        <Button onClick={() => location.reload()}>Reload</Button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </Page>
  );
}

/**
 * Server mode, but the server did not answer (or failed). Never falls back to browser
 * storage on its own: that would start a second, empty copy of the user's data.
 */
export function UnreachableScreen({
  reason,
  onForget,
}: {
  reason: string;
  /** Explicitly switch this address to browser storage (it no longer runs a server). */
  onForget: () => void;
}) {
  return (
    <Page title="Can't reach your Vuurtoren server">
      <p role="alert" style={{ margin: 0 }}>
        {reason}
      </p>
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        Your data is on the server and nothing was changed. It may be restarting; try again in a
        moment. If it keeps failing, check the containers (docker compose ps, docker compose logs
        api).
      </p>
      <div className="row">
        <Button variant="primary" onClick={() => location.reload()}>
          Try again
        </Button>
      </div>
      <details style={{ color: "var(--ink-muted)", fontSize: 13 }}>
        <summary style={{ cursor: "pointer" }}>
          This address no longer runs a Vuurtoren server
        </summary>
        <p style={{ margin: "8px 0" }}>
          Then Vuurtoren can keep data in this browser instead. That is a separate, empty
          collection; your server data is not copied.
        </p>
        <Button size="sm" onClick={onForget}>
          Use this browser's storage
        </Button>
      </details>
    </Page>
  );
}

/** Another tab already owns the browser database. */
export function BusyTabScreen({ onUseHere }: { onUseHere: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "waiting" | "failed">("idle");
  return (
    <Page title="Vuurtoren is open in another tab">
      <p style={{ margin: 0 }}>
        The browser lets only one tab use your data at a time, so this tab is paused.
      </p>
      <div className="row">
        <Button
          variant="primary"
          disabled={state === "waiting"}
          onClick={() => {
            setState("waiting");
            onUseHere().catch(() => setState("failed"));
          }}
        >
          Use here instead
        </Button>
      </div>
      {state === "failed" ? (
        <p className="error-text" role="alert">
          The other tab did not let go. Close it and reload this one.
        </p>
      ) : null}
    </Page>
  );
}

/** This tab gave the database to another tab. */
export function ElsewhereScreen() {
  return (
    <Page title="Opened in another tab">
      <p style={{ margin: 0 }}>Vuurtoren is now running in another tab. You can close this one.</p>
      <div className="row">
        <Button onClick={() => location.reload()}>Use here again</Button>
      </div>
    </Page>
  );
}
