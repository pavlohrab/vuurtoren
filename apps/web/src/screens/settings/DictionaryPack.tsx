/**
 * The language data on a phone (Settings → Your words and the end of the welcome): the
 * `dictionary-nl` pack kept on the device gives words their meanings without a server. The APK
 * carries none (it stays small), so this offers the download with its size and shows its
 * progress. It comes from the data host (data.vuurtoren.app, fast through Cloudflare), else from
 * the connected Vuurtoren server (with the device's sync token); the app checks it against
 * packs.json. On
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

/** Nothing arrived this long after the download started: say so, with Retry. */
const STALL_MS = 20_000;

/** Offline, as far as the WebView can tell. */
function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** The app's own words for a failed download (its messages are plain), else the general text. */
function installError(e: unknown): string {
  if (typeof e === "string" && e) return e;
  if (e instanceof Error && e.message) return e.message;
  return errorText(e);
}

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
    refetchInterval: (q) => (install.isPending || q.state.data?.downloading ? 500 : false),
  });
  // A download that brings nothing for a while (no network, a server that does not answer).
  const [stalled, setStalled] = useState(false);
  const receivedNow = status.data?.received ?? 0;
  const busy = install.isPending || !!status.data?.downloading;
  useEffect(() => {
    if (!busy) return;
    const t = window.setTimeout(() => setStalled(true), STALL_MS);
    return () => {
      window.clearTimeout(t);
      setStalled(false);
    };
  }, [busy, receivedNow]);
  // Back online: the button's words follow.
  const [, setOnline] = useState(0);
  useEffect(() => {
    const on = () => setOnline((n) => n + 1);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  const started = useRef(false);
  const waitingForWifi = !mobileOk && onMobileData();
  const missing = status.data && !status.data.installed && !status.data.downloading;
  useEffect(() => {
    if (autoStart && missing && !waitingForWifi && !offline() && !started.current) {
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
      ) : (install.isPending || s.downloading) && !stalled ? (
        <div role="status" className="stack" style={{ gap: 4 }}>
          <span>
            {received > 0
              ? `Downloading the dictionary: ${formatBytes(received)} of ${size}`
              : `Starting the download (${size})…`}
          </span>
          <progress
            className="k-progress"
            max={total || 1}
            value={received}
            aria-label="Dictionary download"
          />
        </div>
      ) : stalled || install.isError || offline() ? (
        <div className="row" role="alert">
          <span className="dict-problem">
            {install.isError
              ? "The dictionary did not download. Check the connection and try again."
              : offline()
                ? "No connection: the dictionary downloads once you are online."
                : "The download is not getting anywhere: check the connection."}
            {install.isError ? (
              <details className="dict-details">
                <summary>Technical details</summary>
                <code>{installError(install.error)}</code>
              </details>
            ) : null}
          </span>
          <Button
            size="sm"
            onClick={() => {
              setStalled(false);
              install.mutate();
            }}
          >
            Retry
          </Button>
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
    </section>
  );
}

/**
 * Gets the language data by itself (OF4): at every start and whenever the phone comes back
 * online, while the pack is missing, on Wi-Fi (or mobile data when allowed). The welcome used to
 * be the only time it started, so a phone that was offline then never had meanings without its
 * computer. Shows nothing; Settings shows the progress.
 */
export function DictionaryPackKeeper() {
  const pack = currentDevice().bridge?.dictionary ?? null;
  const services = useServices();
  const qc = useQueryClient();
  const running = useRef(false);
  useEffect(() => {
    if (!pack) return;
    const tryNow = async () => {
      if (running.current || offline()) return;
      if (onMobileData() && readLocal(MOBILE_DATA_KEY) !== "1") return;
      running.current = true;
      try {
        const s = await pack.status();
        if (s.installed || s.downloading) return;
        await pack.install((await services.packSource?.()) ?? null);
      } catch {
        // Tried again on the next start or when back online.
      } finally {
        running.current = false;
        void qc.invalidateQueries({ queryKey: ["dictionary-pack"] });
      }
    };
    void tryNow();
    window.addEventListener("online", tryNow);
    return () => window.removeEventListener("online", tryNow);
  }, [pack, services, qc]);
  return null;
}
