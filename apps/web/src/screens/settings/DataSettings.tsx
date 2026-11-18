import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { backupFilename } from "@app/db";
import { Button, Dialog, Skeleton, useToast } from "@app/ui";
import { formatBytes } from "../../format.js";
import { useAppInfo } from "../../shell/AppInfo.js";

/** Save bytes as a file through a temporary link. */
export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: "application/vnd.sqlite3" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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

  const where = data.mode === "server" ? "Stored on your server" : "Stored in this browser";
  return (
    <section className="stack" aria-label="Your data">
      <p style={{ margin: 0 }}>
        <strong>{where}.</strong>{" "}
        {data.mode === "server"
          ? "Every device that opens this address shares one database file on the server."
          : "Only this browser on this device sees it. Download a backup now and then."}
      </p>
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
        description={`This replaces everything stored ${data.mode === "server" ? "on the server" : "in this browser"} with the contents of ${pending?.name ?? "the file"}. The current data is gone unless you downloaded a backup first.`}
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
