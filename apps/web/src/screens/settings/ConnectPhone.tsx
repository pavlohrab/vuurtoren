/**
 * "Connect a phone" on a computer (SY1, mock A of MK4): the computer is its phone's sync place on
 * the home Wi-Fi. "Show the code" starts listening, starts sync here when there is none (no
 * passphrase: a recovery key, shown once) or serves the computer's own sync folder, and shows a QR code with this computer's address, the
 * certificate's fingerprint and a ten-minute code; the phone that scans it gets the sync key and
 * joins at once. The connected phones are listed with Remove. Plain words, nothing more.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "@app/ui";
import { useEffect, useState } from "react";
import { currentDevice } from "../../platform/index.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { lanLink } from "../../sync/connect.js";
import { QrCode } from "./QrCode.js";

export function ConnectPhone() {
  const lan = currentDevice().bridge?.lan;
  const services = useServices();
  const qc = useQueryClient();
  const [shown, setShown] = useState<{
    link: string;
    code: string;
    /** The phones there were when the code appeared: a new one is the phone that scanned it. */
    before: Set<string>;
    /** When the code stops working (ms). */
    until: number;
    /** For a new code: the computer's address, port and certificate. */
    at: { address: string; port: number; fingerprint: string };
  } | null>(null);
  // The code's minutes left, counted down while it shows.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!shown) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [shown]);
  const [recovery, setRecovery] = useState<string | null>(null);
  const phones = useQuery({
    queryKey: ["lan-phones"],
    queryFn: () => lan!.phones(),
    enabled: !!lan,
    refetchInterval: shown ? 3000 : false,
  });
  const show = useMutation({
    mutationFn: async () => {
      const info = await lan!.start();
      // Starts sync here when there is none (a recovery key, shown once); explains when the
      // computer syncs through another place.
      const made = await services.startForPhones!(info.placeDir, "");
      if (made.recoveryKey) setRecovery(made.recoveryKey);
      // A computer on Syncthing or Dropbox: its phone joins that same folder.
      if (made.folder !== info.placeDir) await lan!.start(made.folder);
      const key = await services.phoneHandover!();
      if (!key) throw new Error("Sync is not open on this computer. Unlock it first.");
      const address = info.addresses[0];
      if (!address) throw new Error("This computer is not on a network. Connect it to your Wi-Fi.");
      const code = await lan!.code({ key });
      await qc.invalidateQueries({ queryKey: ["sync"] });
      const before = new Set((await lan!.phones()).map((p) => p.hash));
      const at = { address, port: info.port, fingerprint: info.fingerprint };
      return { ...withCode(at, code), before, at };
    },
    onSuccess: (s) => {
      setRefused(false);
      setShown(s);
    },
  });
  // A new code when the old one ran out (the computer keeps listening).
  const again = useMutation({
    mutationFn: async () => {
      const key = await services.phoneHandover!();
      if (!key || !shown) throw new Error("Sync is not open on this computer. Unlock it first.");
      return withCode(shown.at, await lan!.code({ key }));
    },
    onSuccess: (fresh) => setShown((s) => (s ? { ...s, ...fresh } : s)),
  });
  // Linux with firewalld keeps the phone out unless the port is open (Pavlo's case): ask, and
  // offer to open it (SY9).
  const firewall = useQuery({
    queryKey: ["lan-firewall", shown?.at.port],
    queryFn: () => lan!.firewall!(shown!.at.port),
    enabled: !!shown && !!lan?.firewall,
  });
  const allow = useMutation({
    mutationFn: () => lan!.allowFirewall!(shown!.at.port),
    onSuccess: () => firewall.refetch(),
  });
  // SY12: a phone used the code; nothing goes to it before "Is this your phone?" gets a yes.
  const asking = useQuery({
    queryKey: ["lan-asking"],
    queryFn: async () => (await lan!.asking!()) ?? null,
    enabled: !!shown && !!lan?.asking,
    refetchInterval: 1000,
  });
  const [refused, setRefused] = useState(false);
  const reply = useMutation({
    mutationFn: ({ id, yes }: { id: string; yes: boolean }) => lan!.answer!(id, yes),
    onSuccess: async (_r, { yes }) => {
      if (!yes) {
        // The code is used up: a new one is needed to try again.
        setRefused(true);
        setShown((s) => (s ? { ...s, until: Date.now() } : s));
      }
      await qc.invalidateQueries({ queryKey: ["lan-asking"] });
      await qc.invalidateQueries({ queryKey: ["lan-phones"] });
    },
  });
  const remove = useMutation({
    mutationFn: (hash: string) => lan!.remove(hash),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lan-phones"] }),
  });
  if (!lan || !services.startForPhones || !services.phoneHandover) return null;
  const arrived = shown ? phones.data?.find((p) => !shown.before.has(p.hash)) : undefined;
  const windows = typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

  return (
    <section className="stack connect-phone" aria-labelledby="connect-phone-h" style={{ gap: 10 }}>
      <h3 className="settings-h3" id="connect-phone-h">
        Connect a phone
      </h3>
      {shown && !arrived && asking.data ? (
        <div
          className="stack connect-asking"
          role="alertdialog"
          aria-labelledby="connect-asking-h"
          style={{ gap: 8 }}
        >
          <h4 id="connect-asking-h" className="settings-h3" style={{ margin: 0 }}>
            A phone wants to connect
          </h4>
          <p style={{ margin: 0 }}>
            <b>{asking.data.name}</b>, on your Wi-Fi. Is this your phone? It gets your data and the
            key to it.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <Button
              disabled={reply.isPending}
              onClick={() => reply.mutate({ id: asking.data!.id, yes: false })}
            >
              No
            </Button>
            <Button
              variant="primary"
              disabled={reply.isPending}
              onClick={() => reply.mutate({ id: asking.data!.id, yes: true })}
            >
              Yes, it&apos;s mine
            </Button>
          </div>
        </div>
      ) : shown && arrived ? (
        <div className="stack" style={{ gap: 8 }} role="status">
          <p style={{ margin: 0 }}>
            ✓ <b>{arrived.name}</b> is connected. It&apos;s bringing your data over now.
          </p>
          <div className="row">
            <Button onClick={() => setShown(null)}>Done</Button>
          </div>
        </div>
      ) : shown ? (
        <div className="stack" style={{ gap: 8 }}>
          <QrCode text={shown.link} label="Code to scan with your phone" />
          <p style={{ margin: 0 }}>
            Open Vuurtoren on your phone and scan this. Both need to be on the same Wi-Fi.
          </p>
          {now < shown.until ? (
            <>
              <p className="k-hint" style={{ margin: 0 }}>
                Or type the code: <b>{shown.code}</b>. It works for {left(shown.until - now)} more.
              </p>
              <p className="k-hint row" role="status" style={{ margin: 0, gap: 8 }}>
                <Spinner label="Waiting" />
                Waiting for your phone…
              </p>
            </>
          ) : (
            <div className="row" style={{ alignItems: "center" }}>
              <span className="k-hint">
                {refused
                  ? "That phone got nothing. Show a new code to try again."
                  : "This code ran out."}
              </span>
              <Button onClick={() => again.mutate()} disabled={again.isPending}>
                New code
              </Button>
            </div>
          )}
          {windows ? (
            <p className="k-hint" style={{ margin: 0 }}>
              Windows may ask to allow Vuurtoren on private networks. Say yes.
            </p>
          ) : null}
          {firewall.data?.tool === "firewalld" && firewall.data.open === false ? (
            <div role="note" className="stack firewall-note" style={{ gap: 6 }}>
              <p style={{ margin: 0 }}>
                This computer&apos;s firewall keeps your phone out. Allow Vuurtoren through it?
              </p>
              <div className="row">
                <Button onClick={() => allow.mutate()} disabled={allow.isPending}>
                  Allow Vuurtoren
                </Button>
              </div>
              <p className="k-hint" style={{ margin: 0 }}>
                It asks for your password. Or type it yourself:{" "}
                <code style={{ userSelect: "all" }}>{firewall.data.command}</code>
              </p>
              {allow.isError ? (
                <p role="alert" className="error-text" style={{ margin: 0 }}>
                  {errorText(allow.error)}
                </p>
              ) : null}
            </div>
          ) : null}
          {allow.isSuccess && firewall.data?.open ? (
            <p className="k-hint" role="status" style={{ margin: 0 }}>
              ✓ The firewall lets your phone in now.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="k-hint" style={{ margin: 0 }}>
            Your phone gets your words and texts from this computer when both are home.
          </p>
          <div className="row">
            <Button onClick={() => show.mutate()} disabled={show.isPending}>
              Show the code
            </Button>
          </div>
        </>
      )}
      {recovery ? (
        <div role="note" className="stack" style={{ gap: 4 }}>
          <p style={{ margin: 0 }}>
            Your recovery key. Write it down: it opens your data if this computer is lost.
          </p>
          <code style={{ userSelect: "all" }}>{recovery}</code>
        </div>
      ) : null}
      {show.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(show.error)}
        </p>
      ) : null}
      {phones.data?.length ? (
        <ul className="stack" style={{ gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
          {phones.data.map((p) => (
            <li key={p.hash} className="row" style={{ justifyContent: "space-between" }}>
              <span>{p.name}</span>
              <Button variant="ghost" onClick={() => remove.mutate(p.hash)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** How long a pairing code works (the computer's lan.rs says the same). */
const CODE_MS = 10 * 60_000;

function withCode(at: { address: string; port: number; fingerprint: string }, code: string) {
  return {
    link: lanLink(at.address, at.port, at.fingerprint, code),
    code,
    until: Date.now() + CODE_MS,
  };
}

/** "9:41" for the time left. */
function left(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
