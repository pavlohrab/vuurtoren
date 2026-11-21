/**
 * The language data on a phone (Settings → Your words and the end of the welcome): the
 * `dictionary-nl` pack kept on the device gives words their meanings without a server. The APK
 * carries none (it stays small), so this offers the download with its size and shows its
 * progress. It comes from the connected Vuurtoren server when there is one (with the device's
 * sync token), else from the public packs release; the app checks it against packs.json. On
 * Wi-Fi only unless the learner allows mobile data; a download that stopped goes on from where
 * it was. Without it the app keeps working: meanings from cards and the server, stories in
 * full. Renders nothing where the device has no such pack (computers use their bundled
 * language server).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@app/ui";
import { formatBytes } from "../../format.js";
import { currentDevice } from "../../platform/index.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { readLocal, writeLocal } from "../../storage/local.js";

/** "1": the language data may also download over mobile data (per device). */
const MOBILE_DATA_KEY = "vuurtoren-packs-mobile-data";

/** On mobile data now, as far as the WebView can tell (unknown counts as Wi-Fi). */
function onMobileData(): boolean {
  const c = (navigator as Navigator & { connection?: { type?: string } }).connection;
  return c?.type === "cellular";
}

export function DictionaryPack({ autoStart = false }: { autoStart?: boolean }) {
  const pack = currentDevice().bridge?.dictionary ?? null;
  const services = useServices();
  const qc = useQueryClient();
  const [mobileOk, setMobileOk] = useState(() => readLocal(MOBILE_DATA_KEY) === "1");
  const install = useMutation({
    mutationFn: async () => pack!.install((await services.packSource?.()) ?? null),
    onSettled: () => qc.invalidateQueries({ queryKey: ["dictionary-pack"] }),
  });
  const status = useQuery({
    queryKey: ["dictionary-pack"],
    queryFn: () => pack!.status(),
    enabled: !!pack,
    // While it downloads, the bytes so far.
    refetchInterval: install.isPending ? 500 : false,
  });
  const started = useRef(false);
  const waitingForWifi = !mobileOk && onMobileData();
  const missing = status.data && !status.data.installed && !status.data.downloading;
  useEffect(() => {
    if (autoStart && missing && !waitingForWifi && !started.current) {
      started.current = true;
      install.mutate();
    }
  }, [autoStart, missing, waitingForWifi, install]);

  if (!pack || !status.data) return null;
  const s = status.data;
  const total = s.download || s.bytes;
  const received = s.received ?? 0;
  const size = formatBytes(total);
  const allowMobile = (ok: boolean) => {
    setMobileOk(ok);
    writeLocal(MOBILE_DATA_KEY, ok ? "1" : null);
  };
  return (
    <section className="stack" aria-labelledby="dict-pack-h" style={{ gap: 8 }}>
      <h3 className="settings-h3" id="dict-pack-h">
        Dictionary on this phone
      </h3>
      {s.installed ? (
        <p className="k-hint" style={{ margin: 0 }}>
          Installed ({formatBytes(s.bytes)}). Words get their meaning without a server.
        </p>
      ) : install.isPending || s.downloading ? (
        <div role="status" className="stack" style={{ gap: 4 }}>
          <span>
            Downloading the dictionary: {formatBytes(received)} of {size}
          </span>
          <progress max={total || 1} value={received} aria-label="Dictionary download" />
        </div>
      ) : (
        <>
          <p className="k-hint" style={{ margin: 0 }}>
            Meanings of the words you tap, also offline. Until it is here, meanings come from your
            cards and your server.
          </p>
          {waitingForWifi ? (
            <p className="k-hint" style={{ margin: 0 }}>
              Waiting for Wi-Fi.
            </p>
          ) : null}
          <div className="row">
            <Button onClick={() => install.mutate()}>
              {received > 0
                ? `Go on with the download (${formatBytes(received)} of ${size})`
                : waitingForWifi
                  ? `Download now on mobile data (~${size})`
                  : `Download the dictionary (~${size})`}
            </Button>
          </div>
        </>
      )}
      {!s.installed ? (
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={mobileOk}
            onChange={(e) => allowMobile(e.target.checked)}
          />
          Also download on mobile data
        </label>
      ) : null}
      {install.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          The download did not finish. {errorText(install.error)} Try again to go on from where it
          stopped.
        </p>
      ) : null}
    </section>
  );
}
