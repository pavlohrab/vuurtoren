import { useState } from "react";
import { Button, useToast } from "@app/ui";
import { type DataFile, useAppInfo } from "../shell/AppInfo.js";

const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, "") || path;

/**
 * Settings > Your data in the desktop app (offline mode): where the file is, "Show in folder",
 * "Move…" (copy to another folder and use it from there), and the way to a Vuurtoren server.
 */
export function DesktopDataFile({ file }: { file: DataFile }) {
  const { desktop } = useAppInfo();
  const toast = useToast();
  const [path, setPath] = useState(file.path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown): void =>
    setError(typeof e === "string" ? e : e instanceof Error ? e.message : "That did not work.");

  const move = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const old = path;
      const next = await file.move();
      if (next) {
        setPath(next);
        toast(
          "Data moved",
          `Vuurtoren now uses ${next}. The old file is still in ${folderOf(old)}; delete it when you no longer need it.`,
        );
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <p style={{ margin: 0, overflowWrap: "anywhere" }}>
        <code data-testid="data-file-path">{path}</code>
      </p>
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        Copy this file to back up everything, or keep it in a synced folder (Dropbox, OneDrive,
        Syncthing) to have it on another computer. Open Vuurtoren on one computer at a time.
      </p>
      <div className="row">
        <Button onClick={() => void file.reveal().catch(fail)}>Show in folder</Button>
        <Button onClick={() => void move()} disabled={busy}>
          Move…
        </Button>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {desktop ? (
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          Have a Vuurtoren server?{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => void desktop.connectServer().catch(fail)}
          >
            Connect to a Vuurtoren server
          </button>{" "}
          instead (your data here stays in this file).
        </p>
      ) : null}
    </div>
  );
}
