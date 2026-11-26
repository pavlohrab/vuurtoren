/**
 * Settings → Sync: your data on every device, through a place you choose, encrypted with a
 * passphrase before it leaves the device. On a page served by a Vuurtoren server, that server
 * is offered as the place, and this section also makes sync tokens for your other devices and
 * shows the QR code that connects a phone (Add a phone). Elsewhere, Connect to your server
 * trades such a code (scanned, pasted as a link, or typed) for this device's own token.
 */
import { currentDevice } from "../../platform/index.js";
import { ScanOverlay } from "./ScanOverlay.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button, Input, Skeleton, Spinner, useToast } from "@app/ui";
import { createSyncTokenClient } from "../../auth/tokens.js";
import {
  type ServerAccess,
  connectLink,
  pairingCode,
  parseConnectLink,
  serverAddress,
} from "../../sync/connect.js";
import { relativeTime } from "../../format.js";
import { useServices } from "../../services/context.js";
import type { SetUpHow, SyncPlace, SyncStatus } from "../../services/syncTypes.js";
import { useAppInfo } from "../../shell/AppInfo.js";
import { QrCode } from "./QrCode.js";
import { CopyBlock } from "./shared.js";
import { errorText } from "../../services/errors.js";

const tokens = createSyncTokenClient();

type Kind = SyncPlace["kind"];
/**
 * A choice under Where: this page's own server, the server connected with a pairing code,
 * another server, a folder or WebDAV.
 */
type Choice = "this" | "paired" | Kind;
const HOWS: { how: SetUpHow; title: string; sub: string }[] = [
  {
    how: "join",
    title: "Join my synced data",
    sub: "Your other device already syncs here. Type the passphrase you chose there.",
  },
  {
    how: "start",
    title: "Start new sync data here",
    sub: "This is your first device to sync. You choose a passphrase and get a recovery key.",
  },
];
/** The places this device can choose. */
function choices(status: SyncStatus): { id: Choice; title: string; sub: string }[] {
  const here = status.thisServer ? new URL(status.thisServer).host : null;
  return [
    ...(status.paired
      ? [
          {
            id: "paired" as const,
            title: "Your Vuurtoren server",
            sub: `${new URL(status.paired).host}, connected with a pairing code.`,
          },
        ]
      : []),
    ...(here
      ? [
          {
            id: "this" as const,
            title: "This server",
            sub: `${here}, where this page comes from. It makes its own sync token.`,
          },
        ]
      : []),
    // A phone connected with a pairing code has its server: Change server starts over instead.
    ...(status.paired && status.scan
      ? []
      : [
          {
            id: "server" as const,
            title: here ? "Another Vuurtoren server" : "Your Vuurtoren server",
            sub: "A Vuurtoren server you run yourself.",
          },
        ]),
    ...(status.places.includes("folder")
      ? [
          {
            id: "folder" as const,
            title: "A folder you already sync",
            sub: "A folder that Syncthing, Dropbox or iCloud Drive keeps in sync.",
          },
        ]
      : []),
    ...(status.places.includes("webdav")
      ? [
          {
            id: "webdav" as const,
            title: "WebDAV",
            sub: "Nextcloud, ownCloud or a NAS.",
          },
        ]
      : []),
  ];
}

/** The recovery key waiting to be saved: it stays across reloads of this tab until confirmed. */
const RECOVERY_KEY = "vuurtoren.sync.recovery";
function readPending(): string | null {
  try {
    return sessionStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
}
function writePending(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(RECOVERY_KEY, key);
    else sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    // Kept in the page only.
  }
}

export function SyncSettings() {
  const services = useServices();
  const { account } = useAppInfo();
  const status = useQuery({ queryKey: ["sync", "status"], queryFn: () => services.syncStatus() });
  const [recovery, setRecoveryState] = useState<string | null>(readPending);
  const setRecovery = (key: string | null) => {
    writePending(key);
    setRecoveryState(key);
  };
  if (!status.data) return <Skeleton style={{ height: 120 }} />;
  return (
    <div className="stack settings-stack">
      {recovery ? <RecoveryKey value={recovery} onDone={() => setRecovery(null)} /> : null}
      {status.data.place ? (
        <>
          <SyncOn status={status.data} />
          <Secrets onRecovery={setRecovery} />
        </>
      ) : (
        <NotSyncing status={status.data} onRecovery={setRecovery} />
      )}
      {account ? <AddPhone authOn={account.authEnabled} /> : null}
      {account ? <ServerTokens authOn={account.authEnabled} /> : null}
    </div>
  );
}

/**
 * The welcome's Connect to your server (phones): the same steps as here, without the rest of
 * Settings. First the pairing code (scanned, a link or typed), then the passphrase to join the
 * synced data; once sync is on, one line says so. `onState` tells the welcome how far it got.
 */
export function ConnectYourServer({
  onState,
}: {
  onState?: (state: "none" | "paired" | "on") => void;
}) {
  const services = useServices();
  const status = useQuery({ queryKey: ["sync", "status"], queryFn: () => services.syncStatus() });
  const [recovery, setRecoveryState] = useState<string | null>(readPending);
  const setRecovery = (key: string | null) => {
    writePending(key);
    setRecoveryState(key);
  };
  const state = !status.data
    ? null
    : status.data.place
      ? "on"
      : status.data.paired
        ? "paired"
        : "none";
  useEffect(() => {
    if (state) onState?.(state);
  }, [state, onState]);
  if (!status.data) return <Skeleton style={{ height: 120 }} />;
  const host = status.data.paired ? new URL(status.data.paired).host : null;
  return (
    <div className="stack settings-stack">
      {recovery ? <RecoveryKey value={recovery} onDone={() => setRecovery(null)} /> : null}
      {status.data.place ? (
        <p role="status" style={{ margin: 0 }}>
          Connected{host ? ` to ${host}` : ""}. Sync is on.
        </p>
      ) : (
        <NotSyncing status={status.data} onRecovery={setRecovery} bare />
      )}
    </div>
  );
}

/**
 * Not syncing yet. On a phone (it scans) there is one way in: Scan QR code first, with Enter
 * pairing code and Use an existing sync token under Connect manually; once paired, the
 * connected server and the passphrase. Elsewhere Connect to your server sits above every place.
 */
function NotSyncing({
  status,
  onRecovery,
  bare = false,
}: {
  status: SyncStatus;
  onRecovery: (key: string) => void;
  bare?: boolean;
}) {
  const [withToken, setWithToken] = useState(false);
  const phone = status.scan && !status.thisServer;
  if (status.paired || status.thisServer) {
    return <SetUp key={status.paired ?? ""} status={status} onRecovery={onRecovery} />;
  }
  if (phone && withToken) {
    return (
      <div className="stack settings-stack">
        <SetUp key="token" status={status} onRecovery={onRecovery} />
        <div className="row">
          <Button variant="ghost" onClick={() => setWithToken(false)}>
            Scan the QR code instead
          </Button>
        </div>
      </div>
    );
  }
  if (phone)
    return <ConnectServer status={status} bare={bare} onUseToken={() => setWithToken(true)} />;
  if (bare) return <ConnectServer status={status} bare />;
  return (
    <>
      <ConnectServer status={status} />
      <SetUp key="" status={status} onRecovery={onRecovery} />
    </>
  );
}

/**
 * Connected with a pairing code but not syncing yet: start over with another server. The
 * stored sync token is deleted, so this asks first.
 */
function ChangeServer({ host }: { host: string }) {
  const services = useServices();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const forget = useMutation({
    mutationFn: () => services.stopSync(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync"] }),
  });
  if (!asking) {
    return (
      <div className="row">
        <Button type="button" variant="ghost" onClick={() => setAsking(true)}>
          Change server…
        </Button>
      </div>
    );
  }
  return (
    <div className="stack sync-confirm" role="group" aria-label="Change server">
      <p style={{ margin: 0 }}>
        Forget {host}? This device&apos;s sync token for it is deleted; to come back, connect again
        with a new pairing code.
      </p>
      <div className="row">
        <Button
          type="button"
          variant="primary"
          onClick={() => forget.mutate()}
          disabled={forget.isPending}
        >
          Forget and change server
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </div>
      {forget.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(forget.error)}
        </p>
      ) : null}
    </div>
  );
}

/** A recovery key, shown once: it opens the synced data when the passphrase is forgotten. */
function RecoveryKey({ value, onDone }: { value: string; onDone: () => void }) {
  return (
    <section className="stack sync-recovery" aria-labelledby="recovery-h" role="status">
      <h3 className="settings-h3" id="recovery-h">
        Your recovery key
      </h3>
      <p style={{ margin: 0 }}>
        Keep it in a password manager or on paper. You see it only once, and it opens your data if
        you forget the passphrase.
      </p>
      <CopyBlock label="Recovery key" text={value} />
      <div className="row">
        <Button onClick={onDone}>I have saved it</Button>
      </div>
    </section>
  );
}

/** Change the passphrase, or make a new recovery key, after proving the current one. */
function Secrets({ onRecovery }: { onRecovery: (key: string) => void }) {
  const services = useServices();
  const toast = useToast();
  const [open, setOpen] = useState<"pass" | "key" | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({
    mutationFn: () => services.changeSyncPassphrase(current, next),
    onSuccess: () => {
      reset();
      toast("Passphrase changed", "Use the new one on new devices; your devices keep syncing.");
    },
  });
  const renew = useMutation({
    mutationFn: () => services.newSyncRecoveryKey(current),
    onSuccess: (key) => {
      reset();
      onRecovery(key);
    },
  });
  /** Close the form (or open another): its fields and the last error go. */
  const reset = (form: "pass" | "key" | null = null) => {
    setOpen(form);
    setCurrent("");
    setNext("");
    change.reset();
    renew.reset();
  };
  const busy = change.isPending || renew.isPending;
  const error = change.error ?? renew.error;
  return (
    <section className="stack" aria-labelledby="secrets-h">
      <h3 className="settings-h3" id="secrets-h">
        Passphrase and recovery key
      </h3>
      {open === null ? (
        <div className="row">
          <Button onClick={() => reset("pass")}>Change passphrase…</Button>
          <Button variant="ghost" onClick={() => reset("key")}>
            Make a new recovery key…
          </Button>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (open === "pass") change.mutate();
            else renew.mutate();
          }}
        >
          <Input
            label="Current passphrase or recovery key"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
          {open === "pass" ? (
            <Input
              label="New passphrase"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              hint="At least 8 characters. Your other devices keep syncing."
            />
          ) : (
            <p className="k-hint" style={{ margin: 0 }}>
              The old recovery key stops working.
            </p>
          )}
          <div className="row">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !current || (open === "pass" && next.trim().length < 8)}
            >
              {busy ? <Spinner label="Working" /> : null}
              {open === "pass" ? "Change passphrase" : "Make a new recovery key"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(error)}
        </p>
      ) : null}
    </section>
  );
}

/** Choose a place, a passphrase and this device's name; then the first sync. */
function SetUp({ status, onRecovery }: { status: SyncStatus; onRecovery: (key: string) => void }) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  // A server connected with a pairing code already holds the data of another device.
  const [how, setHow] = useState<SetUpHow | null>(status.paired ? "join" : null);
  const options = choices(status);
  const [choice, setChoice] = useState<Choice>(options[0]!.id);
  const kind: Kind = choice === "this" || choice === "paired" ? "server" : choice;
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
        return choice === "this"
          ? { kind, url: status.thisServer!, token: "" }
          : choice === "paired"
            ? { kind, url: status.paired!, token: "", kept: true }
            : { kind, url: f("url").trim(), token: f("token").trim() };
      case "webdav":
        return { kind, url: f("url").trim(), user: f("user").trim(), password: f("password") };
      case "folder":
        return { kind, path: f("path") };
    }
  };
  const ready =
    how !== null &&
    passphrase.trim().length >= 8 &&
    (choice === "this" || choice === "paired"
      ? true
      : kind === "server"
        ? /^https?:\/\/./.test(f("url").trim())
        : kind === "webdav"
          ? /^https?:\/\/./.test(f("url").trim()) && !!f("user").trim()
          : !!f("path"));

  const start = useMutation({
    mutationFn: () => services.setUpSync(place(), how!, passphrase, name, setProgress),
    onSuccess: async (r) => {
      setPassphrase("");
      if (r.recoveryKey) onRecovery(r.recoveryKey);
      toast(
        r.error ? "Sync is set up" : r.created ? "Sync is on" : "This device is in sync",
        r.error
          ? "The first sync did not finish yet. Vuurtoren tries again by itself."
          : r.created
            ? "Choose Join my synced data on your other devices, with the same passphrase."
            : "Your data from your other devices is here.",
      );
      await qc.invalidateQueries();
    },
    // Whatever happened, show what is set up now.
    onSettled: () => qc.invalidateQueries({ queryKey: ["sync"] }),
  });
  const pick = useMutation({
    mutationFn: () => services.pickSyncFolder(),
    onSuccess: (path) => path && setFields((x) => ({ ...x, path })),
  });
  // One step at a time (SY8): this device and where, then the place's details, then the name
  // and passphrase. Next checks the step and says what is missing, under the field.
  const needsDetails = !(choice === "this" || choice === "paired");
  const steps: ("how" | "where" | "lock")[] = needsDetails
    ? ["how", "where", "lock"]
    : ["how", "lock"];
  const [step, setStep] = useState<"how" | "where" | "lock">("how");
  const [tried, setTried] = useState<Record<string, boolean>>({});
  const at = Math.max(0, steps.indexOf(step));
  const errors = {
    how: how === null ? "Choose one: start new sync data here, or join it." : null,
    url:
      needsDetails && kind !== "folder" && !/^https?:\/\/./.test(f("url").trim())
        ? "An address that starts with https://"
        : null,
    token:
      needsDetails && kind === "server" && !f("token").trim()
        ? "The sync token made on your server (its Settings → Your devices)."
        : null,
    user: kind === "webdav" && !f("user").trim() ? "Your user name on that server." : null,
    password: kind === "webdav" && !f("password") ? "The app password you made there." : null,
    path: kind === "folder" && !f("path") ? "Choose a folder." : null,
    passphrase:
      passphrase.trim().length < 8 ? "At least 8 characters; a few words work well." : null,
  };
  const stepOk = (st: string) =>
    st === "how"
      ? !errors.how
      : st === "where"
        ? !errors.url && !errors.token && !errors.user && !errors.password && !errors.path
        : !errors.passphrase;
  const err = (st: string, key: keyof typeof errors) => (tried[st] ? errors[key] : null);
  const next = () => {
    setTried((t) => ({ ...t, [step]: true }));
    if (stepOk(step)) setStep(steps[at + 1] ?? step);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step !== "lock") return next();
    setTried((t) => ({ ...t, lock: true }));
    if (ready && !start.isPending) start.mutate();
  };

  return (
    <form className="stack" onSubmit={submit} aria-labelledby="sync-h" noValidate>
      <h3 className="settings-h3" id="sync-h">
        Sync your devices
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        Step {at + 1} of {steps.length}
        {step === "how"
          ? ". Your words, texts, reviews and progress on every device, locked on this device with your passphrase before they leave."
          : null}
      </p>

      {step === "how" ? (
        <>
          <fieldset className="sync-kinds">
            <legend className="k-label">This device</legend>
            {HOWS.map((h) => (
              <label key={h.how} className="sync-kind">
                <input
                  type="radio"
                  name="sync-how"
                  checked={how === h.how}
                  onChange={() => {
                    setHow(h.how);
                    start.reset();
                  }}
                />
                <span>
                  <span className="sync-kind-title">{h.title}</span>
                  <span className="k-hint">{h.sub}</span>
                </span>
              </label>
            ))}
            {err("how", "how") ? (
              <span className="k-field-error" role="alert">
                {err("how", "how")}
              </span>
            ) : null}
          </fieldset>
          {options.length === 1 && choice === "paired" ? (
            <p className="sync-connected" role="status" style={{ margin: 0 }}>
              Connected to <strong>{new URL(status.paired!).host}</strong> with a pairing code.
            </p>
          ) : (
            <fieldset className="sync-kinds">
              <legend className="k-label">Where</legend>
              {options.map((k) => (
                <label key={k.id} className="sync-kind">
                  <input
                    type="radio"
                    name="sync-kind"
                    checked={choice === k.id}
                    onChange={() => setChoice(k.id)}
                  />
                  <span>
                    <span className="sync-kind-title">{k.title}</span>
                    <span className="k-hint">{k.sub}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      ) : null}

      {step === "where" && kind === "server" ? (
        <>
          <Input
            label="Server address"
            placeholder="https://vuurtoren.example.org"
            value={f("url")}
            onChange={set("url")}
            error={err("where", "url")}
            autoFocus
          />
          <Input
            label="Sync token"
            placeholder="ksync_…"
            value={f("token")}
            onChange={set("token")}
            autoComplete="off"
            error={err("where", "token")}
          />
        </>
      ) : step === "where" && kind === "webdav" ? (
        <>
          <details className="sync-help">
            <summary>How to set it up with Nextcloud</summary>
            <ol>
              <li>In Nextcloud Files, make a folder named Vuurtoren.</li>
              <li>
                Copy the WebDAV address from Files → Files settings (bottom left) and add /Vuurtoren
                to it.
              </li>
              <li>
                Make an app password: Settings → Security → Devices &amp; sessions → Create new app
                password. Use it here, not your main password.
              </li>
            </ol>
          </details>
          <Input
            label="WebDAV address"
            placeholder="https://cloud.example.org/remote.php/dav/files/you/Vuurtoren"
            value={f("url")}
            onChange={set("url")}
            error={err("where", "url")}
            autoFocus
          />
          <Input
            label="User name"
            value={f("user")}
            onChange={set("user")}
            autoComplete="username"
            error={err("where", "user")}
          />
          <Input
            label="App password"
            type="password"
            value={f("password")}
            onChange={set("password")}
            autoComplete="off"
            error={err("where", "password")}
          />
        </>
      ) : step === "where" ? (
        <>
          <details className="sync-help">
            <summary>How to set it up with Syncthing</summary>
            <ol>
              <li>Make a folder, for example ~/Sync/Vuurtoren.</li>
              <li>In Syncthing, share that folder with your other computers.</li>
              <li>Choose it here on each computer. Phones sync through your server or WebDAV.</li>
            </ol>
          </details>
          <div className="row" style={{ alignItems: "center" }}>
            <Button type="button" onClick={() => pick.mutate()} disabled={pick.isPending}>
              Choose a folder
            </Button>
            <span className="k-hint">{f("path") || "No folder chosen"}</span>
          </div>
          {err("where", "path") ? (
            <span className="k-field-error" role="alert">
              {err("where", "path")}
            </span>
          ) : null}
        </>
      ) : null}

      {step === "lock" ? (
        <>
          <Input
            label="This device's name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="stack" style={{ gap: 4 }}>
            <Input
              label={how === "join" ? "Passphrase or recovery key" : "Passphrase"}
              type={show ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete={how === "join" ? "current-password" : "new-password"}
              autoFocus
              error={err("lock", "passphrase")}
              hint={
                how === "join"
                  ? "The passphrase you chose on your first device, or your recovery key."
                  : "At least 8 characters; a few words are easy to remember. You type it on each of your devices. Only it or the recovery key opens your synced data, so keep both safe."
              }
            />
            <label className="row k-hint" style={{ gap: 6 }}>
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              Show the passphrase
            </label>
          </div>
        </>
      ) : null}

      <div className="row">
        {at > 0 ? (
          <Button type="button" variant="ghost" onClick={() => setStep(steps[at - 1]!)}>
            Back
          </Button>
        ) : null}
        {step === "lock" ? (
          <Button type="submit" variant="primary" disabled={start.isPending}>
            {start.isPending ? <Spinner label="Starting" /> : null}
            {how === "join" ? "Join and sync" : "Start syncing"}
          </Button>
        ) : (
          <Button type="submit" variant="primary">
            Next
          </Button>
        )}
        {start.isPending && progress ? <span className="k-hint">{progress}</span> : null}
      </div>
      {start.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(start.error)}
        </p>
      ) : null}
      {status.paired ? <ChangeServer host={new URL(status.paired).host} /> : null}
    </form>
  );
}

/** Sync is on: when it last ran, the devices, Sync now and Stop. */
function SyncOn({ status }: { status: SyncStatus }) {
  const services = useServices();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  // A computer that shares its folder with phones: stopping (or moving) leaves them behind (D5).
  const lan = currentDevice().bridge?.lan;
  const phones = useQuery({
    queryKey: ["lan-phones"],
    queryFn: () => lan!.phones(),
    enabled: !!lan && stopping && status.place?.kind === "folder",
  });
  const now = useMutation({
    mutationFn: () => services.syncNow(setProgress),
    onSettled: () => qc.invalidateQueries(),
  });
  const stop = useMutation({
    mutationFn: () => services.stopSync(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync"] }),
  });
  const replace = useMutation({
    mutationFn: (id: string) => services.replaceDevice(id),
    onSettled: () => qc.invalidateQueries(),
  });
  // Another device with this one's name: often this same phone before a reinstall.
  const self = status.devices.find((d) => d.self);
  const twins = self
    ? status.devices.filter(
        (d) => !d.self && d.name.trim().toLowerCase() === self.name.trim().toLowerCase(),
      )
    : [];
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
      {status.needsKey ? (
        <Unlock />
      ) : status.error ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          The last sync did not finish: {status.error} Your changes stay on this device until it
          does.
        </p>
      ) : null}
      {status.error && status.place?.computer && status.scan ? <ScanComputerAgain /> : null}
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
      {twins.map((d) => (
        <div key={d.id} className="row" style={{ alignItems: "center" }}>
          <span className="k-hint">
            Another device is called “{d.name}” too
            {d.at ? `, synced ${relativeTime(d.at)}` : ""}. Is it this one, from before?
          </span>
          <Button variant="ghost" onClick={() => replace.mutate(d.id)} disabled={replace.isPending}>
            It's this one
          </Button>
        </div>
      ))}
      {status.problems.length ? <Problems problems={status.problems} /> : null}
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
          {errorText(now.error)}
        </p>
      ) : null}
      {stopping ? (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>
            Stop syncing on this device? Your data stays here and in {status.place!.label}; other
            devices keep syncing.
          </p>
          {phones.data?.length ? (
            <p role="note" style={{ margin: 0 }}>
              {phones.data.length === 1
                ? `${phones.data[0]!.name} syncs with this computer. It will ask you to connect it again: scan the new code, or choose the place this computer moves to.`
                : `${phones.data.length} phones sync with this computer. They will ask you to connect them again.`}
            </p>
          ) : null}
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

/**
 * A phone that can't reach its computer: the computer's address may have changed. Scanning its
 * code again (Settings → Your devices → Connect a phone) updates the address; the phone stays
 * paired.
 */
function ScanComputerAgain() {
  const services = useServices();
  const qc = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const again = useMutation({
    mutationFn: async () => {
      const read = await services.scanConnectLink();
      if (!read) return;
      const link = parseConnectLink(read);
      if (!link || !("pinned" in link)) {
        setProblem("This is not the code from Connect a phone on your computer.");
        return;
      }
      setProblem(null);
      await services.connectServer(link, "", setProgress);
    },
    onSettled: () => {
      setProgress(null);
      void qc.invalidateQueries({ queryKey: ["sync"] });
    },
  });
  const error = problem ?? (again.error ? errorText(again.error) : null);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <p className="k-hint" style={{ margin: 0 }}>
        At home and it doesn't sync? Your computer may have a new address. Scan its QR code again.
      </p>
      <div className="row">
        <Button onClick={() => again.mutate()} disabled={again.isPending}>
          Scan the code again
        </Button>
      </div>
      {again.isPending && progress ? (
        <p className="k-hint row" role="status" style={{ margin: 0, gap: 8 }}>
          <Spinner label="Connecting" />
          {progress}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** This device lost its sync key: the passphrase or the recovery key brings it back. */
function Unlock() {
  const services = useServices();
  const qc = useQueryClient();
  const [secret, setSecret] = useState("");
  const unlock = useMutation({
    mutationFn: () => services.unlockSync(secret),
    onSuccess: () => setSecret(""),
    onSettled: () => qc.invalidateQueries(),
  });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (secret.trim() && !unlock.isPending) unlock.mutate();
      }}
    >
      <p role="alert" style={{ margin: 0 }}>
        Type your passphrase to sync on this device again.
      </p>
      <Input
        label="Enter passphrase"
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        autoComplete="current-password"
        hint="The passphrase of your synced data, or your recovery key."
      />
      <div className="row">
        <Button type="submit" variant="primary" disabled={!secret.trim() || unlock.isPending}>
          {unlock.isPending ? <Spinner label="Unlocking" /> : null}
          Unlock sync
        </Button>
      </div>
      {unlock.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(unlock.error)}
        </p>
      ) : null}
    </form>
  );
}

/** Files and changes sync left out, or still waits for. */
function Problems({ problems }: { problems: SyncStatus["problems"] }) {
  return (
    <details className="sync-problems">
      <summary>
        {problems.length === 1 ? "1 file or change" : `${problems.length} files or changes`} not
        synced
      </summary>
      <ul aria-label="Not synced">
        {problems.map((p) => (
          <li key={p.what}>
            <code>{p.what}</code>{" "}
            <span className="k-hint">
              {p.leftOut ? "left out: " : "waiting: "}
              {p.error}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Connect to your server: the QR code of its Your devices page (scanned on a phone), the link
 * under it, its address with a pairing code, or its address with the server's user name and
 * password. This device gets its own sync token; the passphrase then starts or joins the data
 * (Set up, below).
 */
function ConnectServer({
  status,
  bare = false,
  onUseToken,
}: {
  status: SyncStatus;
  bare?: boolean;
  /** On a phone: Connect manually also offers a sync token made on the server. */
  onUseToken?: () => void;
}) {
  const services = useServices();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  const [withPassword, setWithPassword] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const tried = useRef<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: (link: ServerAccess) =>
      services.connectServer(link, status.deviceName, setProgress),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync"] }),
    onSettled: () => setProgress(null),
  });
  const start = (link: ServerAccess) => {
    setProblem(null);
    connect.mutate(link);
  };
  const scan = useMutation({
    mutationFn: () => services.scanConnectLink(),
    onSuccess: (read) => {
      if (!read) return;
      const link = parseConnectLink(read);
      if (link) start(link);
      else setProblem("This is not a Vuurtoren code. Use the one on your computer or your server.");
    },
  });
  // A vuurtoren://connect link opened the app: connect with it once.
  useEffect(() => {
    let live = true;
    void services.pendingConnectLink().then((pending) => {
      const link = pending ? parseConnectLink(pending) : null;
      if (!live || !link || tried.current === pending) return;
      tried.current = pending;
      setText(pending!);
      start(link);
    });
    return () => {
      live = false;
    };
    // Asked again whenever the status is fetched again (the shell does so when a link arrives).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const fromLink = parseConnectLink(text);
  const server = fromLink ? null : serverAddress(text);
  const typedCode = pairingCode(code);
  const link: ServerAccess | null =
    fromLink ??
    (server && withPassword && user.trim() && password
      ? { server, user: user.trim(), password }
      : server && !withPassword && typedCode
        ? { server, code: typedCode }
        : null);
  const busy = connect.isPending || scan.isPending;
  const error = problem ?? (connect.error ? errorText(connect.error) : null);
  const manual = (
    <>
      <Input
        label="Link or server address"
        placeholder="vuurtoren://connect?… or https://vuurtoren.example.org"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
      {fromLink ? null : (
        <div className="practice-options" role="radiogroup" aria-label="Connect with">
          <button
            type="button"
            role="radio"
            aria-checked={!withPassword}
            className="practice-option"
            aria-pressed={!withPassword}
            onClick={() => setWithPassword(false)}
          >
            A pairing code
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={withPassword}
            className="practice-option"
            aria-pressed={withPassword}
            onClick={() => setWithPassword(true)}
          >
            User name and password
          </button>
        </div>
      )}
      {fromLink ? null : withPassword ? (
        <>
          <Input
            label="User name"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            hint="The sign-in of your server. The password isn't kept."
          />
        </>
      ) : (
        <Input
          label="Pairing code"
          placeholder="ABCDE-FGHJK"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          hint="From your server's Your devices page. It works once, for 10 minutes."
        />
      )}
      <div className="row">
        <Button type="submit" disabled={!link || busy}>
          {connect.isPending ? <Spinner label="Connecting" /> : null}
          Connect
        </Button>
      </div>
    </>
  );
  return (
    <form
      className="stack"
      {...(bare ? { "aria-label": "Connect to your server" } : { "aria-labelledby": "connect-h" })}
      onSubmit={(e) => {
        e.preventDefault();
        if (link && !busy) start(link);
      }}
    >
      {bare ? null : (
        <h3 className="settings-h3" id="connect-h">
          Connect to your server
        </h3>
      )}
      <p className="k-hint" style={{ margin: 0 }}>
        {status.scan
          ? "Scan the code on your computer: Settings → Your devices → Connect a phone. Or the code on your server's Your devices page."
          : "Type your server's address with its user name and password, or the pairing code from its Your devices page."}
      </p>
      {scan.isPending ? (
        <ScanOverlay onCancel={() => void services.cancelScan().catch(() => undefined)} />
      ) : null}
      {status.scan ? (
        <div className="row">
          <Button type="button" variant="primary" onClick={() => scan.mutate()} disabled={busy}>
            {scan.isPending ? <Spinner label="Scanning" /> : null}
            Scan the code
          </Button>
        </div>
      ) : null}
      {status.scan ? (
        <details className="sync-manual">
          <summary>Connect manually</summary>
          <div className="stack">
            <h4 className="settings-h4">Enter pairing code</h4>
            {manual}
            {onUseToken ? (
              <>
                <h4 className="settings-h4">Use an existing sync token</h4>
                <p className="k-hint" style={{ margin: 0 }}>
                  A token made in the server&apos;s Settings → Your devices → Sync tokens.
                </p>
                <div className="row">
                  <Button type="button" onClick={onUseToken}>
                    Use a sync token…
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </details>
      ) : (
        manual
      )}
      {connect.isPending ? (
        <p className="k-hint row" role="status" style={{ margin: 0, gap: 8 }}>
          <Spinner label="Connecting" />
          {progress ?? "Connecting…"}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * On a page of a Vuurtoren server: a QR code that connects a phone. It holds this server's
 * address and a one-time pairing code (10 minutes, used once; a new one appears when it
 * expires), never the passphrase.
 */
function AddPhone({ authOn }: { authOn: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const code = useQuery({
    queryKey: ["pair-code"],
    queryFn: () => tokens.pairCode(),
    enabled: open,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const fetchedAt = code.dataUpdatedAt;
  const validMs = code.data?.validMs;
  // A new code when this one expires; the token list shows the phone once it connected.
  useEffect(() => {
    if (!open || !validMs) return;
    const left = Math.max(1_000, fetchedAt + validMs - Date.now());
    const renew = setTimeout(() => void code.refetch(), left);
    const list = setInterval(() => void qc.invalidateQueries({ queryKey: ["sync-tokens"] }), 5_000);
    return () => {
      clearTimeout(renew);
      clearInterval(list);
    };
  }, [open, fetchedAt, validMs, code, qc]);
  const link = code.data ? connectLink(location.origin, code.data.code) : null;
  return (
    <section className="stack" aria-labelledby="add-phone-h">
      <h3 className="settings-h3" id="add-phone-h">
        Add a phone
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        In the Vuurtoren app on your phone, choose Connect to your server and scan this code. The
        phone gets its own sync token{authOn ? " (listed below, where you can revoke it)" : ""};
        then it asks for your passphrase.
      </p>
      {!open ? (
        <div className="row">
          <Button onClick={() => setOpen(true)}>Show a QR code</Button>
        </div>
      ) : code.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(code.error)}
        </p>
      ) : !link || !code.data ? (
        <Skeleton style={{ height: 224, width: 224 }} />
      ) : (
        <>
          <QrCode text={link} label="QR code to connect a phone" />
          <p style={{ margin: 0 }}>
            Pairing code <code>{code.data.code}</code>{" "}
            <span className="k-hint">
              works once, until {new Date(fetchedAt + code.data.validMs).toLocaleTimeString()}
            </span>
          </p>
          <CopyBlock label="Link (to paste on another device)" text={link} />
          <div className="row">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Hide the code
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/** On a page of a Vuurtoren server: sync tokens for your other devices. */
function ServerTokens({ authOn }: { authOn: boolean }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("Phone");
  const [vault, setVault] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["sync-tokens"],
    queryFn: () => tokens.list(),
    enabled: authOn,
  });
  const make = useMutation({
    mutationFn: () => tokens.create(label, vault),
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
    <section className="stack" aria-labelledby="sync-tokens-h">
      <h3 className="settings-h3" id="sync-tokens-h">
        Sync tokens
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        Your other devices sync through this server too: in their Settings → Your devices, choose
        Your Vuurtoren server and give this address and a sync token. A token also opens this
        server&apos;s language server, and nothing else.
      </p>
      <CopyBlock label="Server address" text={location.origin} />
      {authOn ? (
        <>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Input label="Device" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Button variant="primary" onClick={() => make.mutate()} disabled={make.isPending}>
              Make a sync token
            </Button>
          </div>
          <label className="settings-check">
            <input type="checkbox" checked={vault} onChange={(e) => setVault(e.target.checked)} />
            <span>
              May change the passphrase and recovery key
              <small>
                Without it, the device syncs but cannot replace the file that opens your data.
              </small>
            </span>
          </label>
        </>
      ) : (
        <p className="k-hint" style={{ margin: 0 }}>
          Sign-in is off on this server, so devices need no token. Turn sign-in on before this
          address is reachable from the internet.
        </p>
      )}
      {make.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(make.error)}
        </p>
      ) : null}
      {fresh ? (
        <>
          <p role="status" style={{ margin: 0 }}>
            Copy it now, because you see it only once. It opens sync and the language server,
            nothing else.
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
                  {t.vault ? ", may change the passphrase" : ""}
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
