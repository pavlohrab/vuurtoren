import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { backupFilename } from "@app/db";
import { Button, Dialog, Skeleton, useToast } from "@app/ui";
import { formatBytes } from "../../format.js";
import { saveFile } from "../../saveFile.js";
import { DesktopDataFile } from "../../desktop/DesktopData.js";
import { useAppInfo } from "../../shell/AppInfo.js";

/** Save a backup file. */
export function downloadBytes(bytes: Uint8Array, filename: string): void {
  saveFile(bytes, filename, "application/vnd.sqlite3");
}

/** Settings > Your data: where the data lives, its size, backup and restore. */
export function DataSettings() {
  const { data } = useAppInfo();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = useQuery({
    queryKey: ["data-info"],
    queryFn: () => (data ? data.admin.info() : Promise.reject(new Error("no data"))),
    enabled: Boolean(data),
  });

  if (!data) {
    return (
      <section className="stack" aria-label="Your data">
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          This is demo data. Nothing is stored and there is nothing to back up.
        </p>
      </section>
    );
  }

  const download = async (): Promise<void> => {
    setError(null);
    try {
      downloadBytes(await data.admin.exportBackup(), backupFilename());
    } catch (e) {
      setError(e instanceof Error ? e.message : "The backup could not be created.");
    }
  };

  const restore = async (): Promise<void> => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await data.admin.importBackup(new Uint8Array(await pending.arrayBuffer()));
      toast("Backup restored", "Reloading with the restored data.");
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The backup could not be restored.");
      setBusy(false);
    }
    setPending(null);
  };

  const where =
    data.mode === "desktop"
      ? "Stored on this computer"
      : data.mode === "phone"
        ? "Stored on this phone"
        : "Stored in this browser";
  const place =
    data.mode === "desktop"
      ? "in your data file"
      : data.mode === "phone"
        ? "in this app"
        : "in this browser";
  return (
    <section className="stack" aria-label="Your data">
      <p style={{ margin: 0 }}>
        <strong>{where}.</strong>{" "}
        {data.mode === "desktop"
          ? "One file you can see, copy and back up like any other document."
          : data.mode === "phone"
            ? "Only this app on this phone sees it. Sync it with your other devices, or download a backup now and then."
            : "Only this browser on this device sees it. Sync it with your other devices, or download a backup now and then."}
      </p>
      {data.file ? <DesktopDataFile file={data.file} /> : null}
      {data.mode === "browser" ? (
        <p style={{ margin: 0, color: "var(--ink-muted)" }} role="status">
          {!data.persistent
            ? "Not saved: this browser cannot store data here, so it disappears when the tab closes."
            : data.persisted === true
              ? "The browser has promised to keep this data (persistent storage granted)."
              : data.persisted === false
                ? "The browser may clear this data when disk space runs low (persistent storage was not granted). Keep a backup."
                : "Persistent storage is not supported by this browser."}
        </p>
      ) : null}
      {!data.secure ? (
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          This page is not a secure context (plain http), so some browser features are limited.
        </p>
      ) : null}
      {info.data ? (
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          {formatBytes(info.data.sizeBytes)}, {info.data.eventCount.toLocaleString("en")} events
          {info.data.deviceId ? `, device ${info.data.deviceId}` : ""}.
        </p>
      ) : info.isLoading ? (
        <Skeleton style={{ height: 18, width: 260 }} />
      ) : null}
      <div className="row">
        <Button onClick={() => void download()}>Download backup (.sqlite)</Button>
        <Button onClick={() => fileInput.current?.click()} disabled={busy}>
          Restore from backup…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/octet-stream"
          hidden
          aria-label="Backup file"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (f) setPending(f);
          }}
        />
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title="Replace your data with this backup?"
        description={`This replaces everything stored ${place} with the contents of ${pending?.name ?? "the file"}. The current data is gone unless you downloaded a backup first.`}
      >
        <div className="row">
          <Button variant="danger" onClick={() => void restore()} disabled={busy}>
            Replace my data
          </Button>
          <Button onClick={() => setPending(null)}>Cancel</Button>
        </div>
      </Dialog>
    </section>
  );
}
