import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "@app/ui";
import { useServices } from "../services/context.js";
import { useAppInfo } from "../shell/AppInfo.js";
import type { SidecarStatus } from "./bridge.js";
import { ocrAvailable, setupView } from "./setup.js";

const KEY = ["desktop", "sidecar"] as const;

/** The bundled language server's state (offline mode; null elsewhere). Polls while it sets up. */
function useSidecar(): SidecarStatus | null {
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
 * Can photos and scanned pages be read here? The language server's `/health` says: the bundled
 * one's status in the desktop app, the configured one elsewhere. True until the answer arrives.
 */
export function useOcrAvailable(): boolean {
  const { desktop } = useAppInfo();
  const services = useServices();
  const status = useSidecar();
  const remote = useQuery({
    queryKey: ["ocr-available"],
    queryFn: () => services.ocrAvailable(),
    enabled: !desktop,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return desktop ? ocrAvailable(status) : (remote.data ?? true);
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
