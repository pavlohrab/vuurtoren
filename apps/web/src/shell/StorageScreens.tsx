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

/** The app could not open its data (the desktop app's file). Nothing was changed. */
export function StartFailedScreen({ reason }: { reason: string }) {
  return (
    <Page title="Vuurtoren could not start">
      <p role="alert" style={{ margin: 0 }}>
        {reason}
      </p>
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        Nothing was changed or deleted. Close other programs that may use the file and try again.
      </p>
      <div className="row">
        <Button variant="primary" onClick={() => location.reload()}>
          Try again
        </Button>
      </div>
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
