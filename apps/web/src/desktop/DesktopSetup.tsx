import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "@app/ui";
import { useAppInfo } from "../shell/AppInfo.js";
import type { SidecarStatus } from "./bridge.js";
import { ocrAvailable, setupView } from "./setup.js";

const KEY = ["desktop", "sidecar"] as const;

/** The bundled language server's state (offline mode; null elsewhere). Polls while it sets up. */
export function useSidecar(): SidecarStatus | null {
  const { desktop } = useAppInfo();
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => (desktop ? desktop.nlp.status() : Promise.resolve(null)),
    enabled: Boolean(desktop),
    refetchInterval: (query) => (setupView(query.state.data) ? 1500 : 60_000),
    staleTime: 1000,
  });
  return q.data ?? null;
}

/**
 * Can photos be read here? Always in the browser and server modes (the server says so when it
 * cannot); in the desktop app only when its language server found Tesseract.
 */
export function useOcrAvailable(): boolean {
  const { desktop } = useAppInfo();
  const status = useSidecar();
  return desktop ? ocrAvailable(status) : true;
}

/**
 * First start of the offline app: a calm card above every page while the language tools start
 * and download their data ("Downloading the Dutch dictionary… 14 MB"). Library, Anki and
 * settings work meanwhile; reading help appears when it is done. Gone once all is ready.
 */
export function DesktopSetup() {
  const { desktop } = useAppInfo();
  const status = useSidecar();
  const qc = useQueryClient();
  const view = setupView(status);
  if (!desktop || !view) return null;
  const act = async (): Promise<void> => {
    if (view.action === "restart") await desktop.nlp.restart();
    if (view.action === "retry-packs") await desktop.nlp.retryPacks();
    await qc.invalidateQueries({ queryKey: KEY });
  };
  return (
    <div className="shell-notices">
      <div
        className={`shell-notice desktop-setup${view.tone === "error" ? " desktop-setup--error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {view.tone === "progress" ? <Spinner label="Setting up" /> : null}
        <span className="shell-notice-text">
          {view.message}
          {view.tone === "progress" ? (
            <span className="desktop-setup-sub">
              {" "}
              The library and Anki work already; word help appears when this is done.
            </span>
          ) : null}
        </span>
        {view.progress !== undefined ? (
          <span
            className="desktop-setup-bar"
            role="progressbar"
            aria-label="Download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(view.progress * 100)}
          >
            <span style={{ width: `${Math.round(view.progress * 100)}%` }} />
          </span>
        ) : null}
        {view.action ? (
          <Button size="sm" onClick={() => void act()}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
