/**
 * Android: the volume keys turn the reader's pages, when the reader asks for them. The app
 * (MainActivity.kt) offers `window.VuurtorenKeys`; while the page has said yes, a press of
 * volume down or up comes to `window.__vuurtorenVolumeKey(1 | -1)` instead of changing the
 * volume. Everywhere else there are no such keys.
 */

declare global {
  interface Window {
    VuurtorenKeys?: { setVolumeKeys(on: boolean): void };
    __vuurtorenVolumeKey?: (dir: number) => void;
  }
}

/** True in the Android app, where the volume keys can turn pages. */
export function hasVolumeKeys(): boolean {
  return typeof window !== "undefined" && !!window.VuurtorenKeys;
}

/**
 * Take the volume keys: down is the next page, up the previous one. Returns the function that
 * gives them back to the phone.
 */
export function takeVolumeKeys(onKey: (dir: 1 | -1) => void): () => void {
  const bridge = typeof window === "undefined" ? undefined : window.VuurtorenKeys;
  if (!bridge) return () => {};
  const handler = (dir: number) => onKey(dir < 0 ? -1 : 1);
  window.__vuurtorenVolumeKey = handler;
  try {
    bridge.setVolumeKeys(true);
  } catch {
    return () => {};
  }
  return () => {
    if (window.__vuurtorenVolumeKey === handler) delete window.__vuurtorenVolumeKey;
    try {
      bridge.setVolumeKeys(false);
    } catch {
      /* the app is going away */
    }
  };
}
