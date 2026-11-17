import { useState, type ReactNode } from "react";
import { Button, Input } from "@app/ui";
import { downloadBytes } from "../screens/DataSettings.js";
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
      <h1 style={{ fontSize: 26 }}>{title}</h1>
      {children}
    </main>
  );
}

/** The stored database was written by a newer Kenning: never fall back to demo data. */
export function BlockedScreen({
  message,
  download,
}: {
  message: string;
  download: () => Promise<Uint8Array>;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Page title="Your data needs a newer Kenning">
      <p role="alert" style={{ margin: 0 }}>
        {message}
      </p>
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        Nothing was changed or deleted. Update Kenning (pull the newest version and rebuild or
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

/** The server needs an access token. */
export function LoginScreen({
  error,
  onSubmit,
}: {
  error?: string | undefined;
  onSubmit: (token: string) => void;
}) {
  const [token, setToken] = useState("");
  return (
    <Page title="Sign in to your Kenning server">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (token.trim()) onSubmit(token.trim());
        }}
      >
        <Input
          label="Access token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <div className="row">
          <Button type="submit" variant="primary">
            Continue
          </Button>
        </div>
        <span className="k-hint">
          It is the KENNING_TOKEN of the server. It is remembered in this browser.
        </span>
      </form>
    </Page>
  );
}

/** Another tab already owns the browser database. */
export function BusyTabScreen({ onUseHere }: { onUseHere: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "waiting" | "failed">("idle");
  return (
    <Page title="Kenning is open in another tab">
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
      <p style={{ margin: 0 }}>Kenning is now running in another tab. You can close this one.</p>
      <div className="row">
        <Button onClick={() => location.reload()}>Use here again</Button>
      </div>
    </Page>
  );
}
