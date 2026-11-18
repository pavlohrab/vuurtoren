import { Button } from "@app/ui";
import { applyUpdate, promptInstall, usePwa } from "./pwa.js";

/** "A new version is ready — Reload", shown once a new service worker is waiting. */
export function UpdateBanner() {
  const { updateReady } = usePwa();
  if (!updateReady) return null;
  return (
    <div role="status" className="k-toast pwa-update">
      <span>A new version is ready</span>
      <Button variant="primary" size="sm" onClick={applyUpdate}>
        Reload
      </Button>
    </div>
  );
}

/** Settings → Advanced: install Kenning as an app, when the browser offers it. */
export function InstallApp() {
  const { canInstall } = usePwa();
  if (!canInstall) return null;
  return (
    <div className="settings-field">
      <span className="k-label">Install Kenning</span>
      <p className="k-hint">
        Opens Kenning in its own window, with an icon in your app menu, and starts without a
        connection.
      </p>
      <div>
        <Button onClick={() => void promptInstall()}>Install app</Button>
      </div>
    </div>
  );
}
