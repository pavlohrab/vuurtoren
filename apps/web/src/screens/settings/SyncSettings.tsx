/**
 * Settings → Sync: your data on every device, through a place you choose, encrypted with a
 * passphrase before it leaves the device. On a page of a Kenning server (which holds the data
 * itself) this section makes sync tokens for the devices that keep their own data.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Button, Input, Skeleton, Spinner, useToast } from "@app/ui";
import { createSyncTokenClient } from "../../auth/mcpTokens.js";
import { relativeTime } from "../../format.js";
import { useServices } from "../../services/context.js";
import type { SyncPlace, SyncStatus } from "../../services/syncTypes.js";
import { useAppInfo } from "../../shell/AppInfo.js";
import { CopyBlock } from "./ClaudeCodeSettings.js";

const message = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "That did not work.";
const tokens = createSyncTokenClient();

type Kind = SyncPlace["kind"];
const KINDS: { kind: Kind; title: string; sub: string }[] = [
  {
    kind: "server",
    title: "Your Kenning server",
    sub: "A Kenning server you run. Make a sync token in its Settings → Sync.",
  },
  {
    kind: "folder",
    title: "A folder you already sync",
    sub: "Syncthing, Dropbox, iCloud Drive, OneDrive. The desktop app writes into it.",
  },
  {
    kind: "webdav",
    title: "WebDAV",
    sub: "Nextcloud, ownCloud, a NAS. Use an app password.",
  },
  {
    kind: "github",
    title: "A private GitHub repository",
    sub: "A fine-grained token that may read and write this repository's contents.",
  },
];

export function SyncSettings() {
  const services = useServices();
  const status = useQuery({ queryKey: ["sync", "status"], queryFn: () => services.syncStatus() });
  if (!status.data) return <Skeleton style={{ height: 120 }} />;
  if (!status.data.available) return <ServerTokens />;
  return status.data.place ? <SyncOn status={status.data} /> : <SetUp status={status.data} />;
}

/** Choose a place, a passphrase and this device's name; then the first sync. */
function SetUp({ status }: { status: SyncStatus }) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("server");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [passphrase, setPassphrase] = useState("");
  const [show, setShow] = useState(false);
  const [name, setName] = useState(status.deviceName);
  const [progress, setProgress] = useState<string | null>(null);
  const f = (k: string) => fields[k] ?? "";
  const set = (k: string) => (e: { target: { value: string } }) =>
    setFields((x) => ({ ...x, [k]: e.target.value }));

  const place = (): SyncPlace => {
    switch (kind) {
      case "server":
        return { kind, url: f("url").trim(), token: f("token").trim() };
      case "webdav":
        return { kind, url: f("url").trim(), user: f("user").trim(), password: f("password") };
      case "github":
        return {
          kind,
          repo: f("repo").trim(),
          token: f("token").trim(),
          ...(f("branch").trim() ? { branch: f("branch").trim() } : {}),
        };
      case "folder":
        return { kind, path: f("path") };
    }
  };
  const ready =
    passphrase.trim().length >= 8 &&
    (kind === "server"
      ? /^https?:\/\/./.test(f("url").trim())
      : kind === "webdav"
        ? /^https?:\/\/./.test(f("url").trim()) && !!f("user").trim()
        : kind === "github"
          ? /^[\w.-]+\/[\w.-]+$/.test(f("repo").trim()) && !!f("token").trim()
          : !!f("path"));

  const start = useMutation({
    mutationFn: () => services.setUpSync(place(), passphrase, name, setProgress),
    onSuccess: async (r) => {
      setPassphrase("");
      toast(
        r.created ? "Sync is on" : "This device is in sync",
        r.created
          ? "Use the same passphrase on your other devices."
          : "Your data from your other devices is here.",
      );
      await qc.invalidateQueries();
    },
  });
  const pick = useMutation({
    mutationFn: () => services.pickSyncFolder(),
    onSuccess: (path) => path && setFields((x) => ({ ...x, path })),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready && !start.isPending) start.mutate();
  };
  const kinds = KINDS.filter((k) => k.kind !== "folder" || status.folders);

  return (
    <form className="stack" onSubmit={submit} aria-labelledby="sync-h">
      <h3 className="settings-h3" id="sync-h">
        Sync your devices
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        Your words, texts, reviews and progress on every device. Everything is encrypted on this
        device with your passphrase before it leaves; the place you choose only stores sealed files.
      </p>
      <fieldset className="sync-kinds">
        <legend className="k-label">Where</legend>
        {kinds.map((k) => (
          <label key={k.kind} className="sync-kind">
            <input
              type="radio"
              name="sync-kind"
              checked={kind === k.kind}
              onChange={() => setKind(k.kind)}
            />
            <span>
              <span className="sync-kind-title">{k.title}</span>
              <span className="k-hint">{k.sub}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {kind === "server" ? (
        <>
          <Input
            label="Server address"
            placeholder="https://kenning.example.org"
            value={f("url")}
            onChange={set("url")}
          />
          <Input
            label="Sync token"
            placeholder="ksync_…"
            value={f("token")}
            onChange={set("token")}
            autoComplete="off"
          />
        </>
      ) : kind === "webdav" ? (
        <>
          <Input
            label="WebDAV address"
            placeholder="https://cloud.example.org/remote.php/dav/files/you/Kenning"
            value={f("url")}
            onChange={set("url")}
          />
          <Input
            label="User name"
            value={f("user")}
            onChange={set("user")}
            autoComplete="username"
          />
          <Input
            label="App password"
            type="password"
            value={f("password")}
            onChange={set("password")}
            autoComplete="off"
          />
        </>
      ) : kind === "github" ? (
        <>
          <Input
            label="Repository"
            placeholder="you/kenning-sync"
            value={f("repo")}
            onChange={set("repo")}
          />
          <Input
            label="Token"
            placeholder="github_pat_…"
            value={f("token")}
            onChange={set("token")}
            autoComplete="off"
          />
          <Input label="Branch (optional)" value={f("branch")} onChange={set("branch")} />
        </>
      ) : (
        <div className="row" style={{ alignItems: "center" }}>
          <Button type="button" onClick={() => pick.mutate()} disabled={pick.isPending}>
            Choose a folder
          </Button>
          <span className="k-hint">{f("path") || "No folder chosen"}</span>
        </div>
      )}

      <Input label="This device's name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="stack" style={{ gap: 4 }}>
        <Input
          label="Passphrase"
          type={show ? "text" : "password"}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="new-password"
          hint="At least 8 characters; a few words are easy to remember. The same on every device. Kenning cannot recover it."
        />
        <label className="row k-hint" style={{ gap: 6 }}>
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show the passphrase
        </label>
      </div>
      <div className="row">
        <Button type="submit" variant="primary" disabled={!ready || start.isPending}>
          {start.isPending ? <Spinner label="Starting" /> : null}
          Start syncing
        </Button>
        {start.isPending && progress ? <span className="k-hint">{progress}</span> : null}
      </div>
      {start.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {message(start.error)}
        </p>
      ) : null}
    </form>
  );
}

/** Sync is on: when it last ran, the devices, Sync now and Stop. */
function SyncOn({ status }: { status: SyncStatus }) {
  const services = useServices();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const now = useMutation({
    mutationFn: () => services.syncNow(setProgress),
    onSettled: () => qc.invalidateQueries(),
  });
  const stop = useMutation({
    mutationFn: () => services.stopSync(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync"] }),
  });
  const last = status.last;
  return (
    <section className="stack" aria-labelledby="sync-h">
      <h3 className="settings-h3" id="sync-h">
        Sync is on
      </h3>
      <p style={{ margin: 0 }}>
        {status.place!.label}
        {last ? (
          <span className="k-hint">
            {" "}
            · synced {relativeTime(last.at)}
            {last.sent || last.received ? ` (${last.sent} sent, ${last.received} received)` : ""}
          </span>
        ) : null}
      </p>
      {status.error ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          The last sync did not finish: {status.error} Your changes stay on this device until it
          does.
        </p>
      ) : null}
      {status.devices.length ? (
        <ul className="sync-devices" aria-label="Devices">
          {status.devices.map((d) => (
            <li key={d.id}>
              <span>{d.name}</span>
              <span className="k-hint">
                {d.self ? "this device" : d.at ? `synced ${relativeTime(d.at)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="k-hint" style={{ margin: 0 }}>
        Kenning syncs by itself while it is open. On another device choose the same place and type
        the same passphrase.
      </p>
      <div className="row">
        <Button variant="primary" onClick={() => now.mutate()} disabled={now.isPending}>
          {now.isPending ? <Spinner label="Syncing" /> : null}
          Sync now
        </Button>
        {now.isPending && progress ? <span className="k-hint">{progress}</span> : null}
        {!stopping ? (
          <Button variant="ghost" onClick={() => setStopping(true)}>
            Stop syncing…
          </Button>
        ) : null}
      </div>
      {now.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {message(now.error)}
        </p>
      ) : null}
      {stopping ? (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>
            Stop syncing on this device? Your data stays here and in {status.place!.label}; other
            devices keep syncing.
          </p>
          <div className="row">
            <Button onClick={() => stop.mutate()} disabled={stop.isPending}>
              Stop syncing
            </Button>
            <Button variant="ghost" onClick={() => setStopping(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** On a page of a Kenning server: sync tokens for the devices that keep their own data. */
function ServerTokens() {
  const { data, account } = useAppInfo();
  const server = data?.mode === "server";
  const authOn = account?.authEnabled ?? false;
  const qc = useQueryClient();
  const [label, setLabel] = useState("Phone");
  const [fresh, setFresh] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["sync-tokens"],
    queryFn: () => tokens.list(),
    enabled: server && authOn,
  });
  const make = useMutation({
    mutationFn: () => tokens.create(label),
    onSuccess: async (t) => {
      setFresh(t.token);
      await qc.invalidateQueries({ queryKey: ["sync-tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => tokens.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync-tokens"] }),
  });
  return (
    <section className="stack" aria-labelledby="sync-h">
      <h3 className="settings-h3" id="sync-h">
        Sync your devices
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        This page uses your data on this server directly, so it is always up to date. The desktop
        app and phones keep their own data and sync through this server: in their Settings → Sync,
        choose Your Kenning server and give this address and a sync token.
      </p>
      <CopyBlock label="Server address" text={location.origin} />
      {authOn ? (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Input label="Device" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button variant="primary" onClick={() => make.mutate()} disabled={make.isPending}>
            Make a sync token
          </Button>
        </div>
      ) : (
        <p className="k-hint" style={{ margin: 0 }}>
          Sign-in is off on this server, so devices need no token. Turn sign-in on before this
          address is reachable from the internet.
        </p>
      )}
      {make.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {message(make.error)}
        </p>
      ) : null}
      {fresh ? (
        <>
          <p role="status" style={{ margin: 0 }}>
            Copy it now: the token is shown only once. It opens sync and nothing else.
          </p>
          <CopyBlock label="Sync token" text={fresh} />
        </>
      ) : null}
      {list.data?.length ? (
        <ul className="sync-devices" aria-label="Sync tokens">
          {list.data.map((t) => (
            <li key={t.id}>
              <span>
                {t.label}{" "}
                <span className="k-hint">
                  made {relativeTime(t.createdAt)}
                  {t.lastUsedAt ? `, last used ${relativeTime(t.lastUsedAt)}` : ", not used yet"}
                </span>
              </span>
              <Button
                variant="ghost"
                onClick={() => revoke.mutate(t.id)}
                aria-label={`Revoke ${t.label}`}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
