import { useState } from "react";
import { Button, useToast } from "@app/ui";
import type { DataFile } from "../shell/AppInfo.js";

const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, "") || path;

/**
 * Settings > Your data in the desktop app: where the file is, "Show in folder" and "Move…"
 * (copy to another folder and use it from there).
 */
export function DesktopDataFile({ file }: { file: DataFile }) {
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
        Copy this file to back up everything. To have your data on another device too, use Settings
        → Your devices; keep this file out of folders that Dropbox, OneDrive or Syncthing copy.
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
    </div>
  );
}
