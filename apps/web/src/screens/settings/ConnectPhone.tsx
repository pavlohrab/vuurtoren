/**
 * "Connect a phone" on a computer (SY1, mock A of MK4): the computer is its phone's sync place on
 * the home Wi-Fi. "Show the code" starts listening, starts sync here when there is none (no
 * passphrase: a recovery key, shown once) or serves the computer's own sync folder, and shows a QR code with this computer's address, the
 * certificate's fingerprint and a ten-minute code; the phone that scans it gets the sync key and
 * joins at once. The connected phones are listed with Remove. Plain words, nothing more.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@app/ui";
import { useState } from "react";
import { currentDevice } from "../../platform/index.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { lanLink } from "../../sync/connect.js";
import { QrCode } from "./QrCode.js";

export function ConnectPhone() {
  const lan = currentDevice().bridge?.lan;
  const services = useServices();
  const qc = useQueryClient();
  const [shown, setShown] = useState<{ link: string; code: string } | null>(null);
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
      return { link: lanLink(address, info.port, info.fingerprint, code), code };
    },
    onSuccess: setShown,
  });
  const remove = useMutation({
    mutationFn: (hash: string) => lan!.remove(hash),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lan-phones"] }),
  });
  if (!lan || !services.startForPhones || !services.phoneHandover) return null;
  const windows = typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

  return (
    <section className="stack connect-phone" aria-labelledby="connect-phone-h" style={{ gap: 10 }}>
      <h3 className="settings-h3" id="connect-phone-h">
        Connect a phone
      </h3>
      {shown ? (
        <div className="stack" style={{ gap: 8 }}>
          <QrCode text={shown.link} label="Code to scan with your phone" />
          <p style={{ margin: 0 }}>
            Open Vuurtoren on your phone and scan this. Both need to be on the same Wi-Fi.
          </p>
          <p className="k-hint" style={{ margin: 0 }}>
            Or type the code: <b>{shown.code}</b>. It works for ten minutes.
          </p>
          {windows ? (
            <p className="k-hint" style={{ margin: 0 }}>
              Windows may ask to allow Vuurtoren on private networks. Say yes.
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
