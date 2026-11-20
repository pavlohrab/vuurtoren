import { useState } from "react";
import { Button, LogoMark, Spinner } from "@app/ui";
import { relativeTime } from "../format.js";
import type { DbLock } from "./bridge.js";

/**
 * Offline mode: the data file is open in Kenning on another computer (the lock file next to it
 * says so; the folder is synced by Dropbox, OneDrive, …). Opening it here too can lose changes,
 * so the user decides.
 */
export function LockedScreen({
  path,
  lock,
  onOpenAnyway,
}: {
  path: string;
  lock: DbLock;
  onOpenAnyway: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="signin">
      <main className="signin-main" aria-labelledby="locked-title">
        <header className="signin-brand">
          <LogoMark size={56} />
        </header>
        <section className="signin-card">
          <h1 id="locked-title" className="signin-title">
            Kenning is open on another computer
          </h1>
          <p className="signin-lede" role="alert">
            Your data file is in use by Kenning on <strong>{lock.host}</strong> (last active{" "}
            {relativeTime(lock.seen * 1000)}). The folder is probably synced between computers. If
            both change the file at the same time, one side’s changes are lost.
          </p>
          <p className="signin-lede">
            Close Kenning on {lock.host} and wait until the sync tool has finished, then try again.
            If Kenning is not running there any more (it crashed, or the computer is off), open it
            here.
          </p>
          <p className="signin-lede" style={{ overflowWrap: "anywhere" }}>
            <code>{path}</code>
          </p>
          <div className="row">
            <Button variant="primary" onClick={() => location.reload()} disabled={busy}>
              Try again
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onOpenAnyway().finally(() => setBusy(false));
              }}
            >
              {busy ? <Spinner label="Opening" /> : null}
              Open anyway
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
