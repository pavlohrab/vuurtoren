/**
 * Safe areas from the Android app: edge to edge, the page runs under the status bar and the
 * gesture handle. Where the WebView does not report them as `env(safe-area-inset-*)`, the app
 * (MainActivity.kt) gives the window insets in CSS pixels: once through
 * `window.VuurtorenInsets.get()` and again through `window.__vuurtorenInsets` when they change.
 * They become `--native-safe-*` on the root, and the `--safe-*` tokens take the larger value.
 */

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

declare global {
  interface Window {
    VuurtorenInsets?: { get(): string };
    __vuurtorenInsets?: (insets: Insets) => void;
  }
}

const SIDES = ["top", "right", "bottom", "left"] as const;

/** Set the insets as `--native-safe-*` on the root element. */
export function applyInsets(insets: Partial<Insets>, root = document.documentElement): void {
  for (const side of SIDES) {
    const px = insets[side];
    if (typeof px === "number" && Number.isFinite(px) && px >= 0)
      root.style.setProperty(`--native-safe-${side}`, `${Math.round(px)}px`);
  }
}

/** Take the app's insets now and whenever they change; nothing outside the Android app. */
export function installNativeInsets(): void {
  const source = window.VuurtorenInsets;
  if (!source) return;
  window.__vuurtorenInsets = (insets) => applyInsets(insets);
  try {
    applyInsets(JSON.parse(source.get()) as Partial<Insets>);
  } catch {
    // No insets yet: they arrive with the first layout.
  }
}
