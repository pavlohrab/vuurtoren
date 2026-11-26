/**
 * Focus mode in the reader fills the whole screen: the system bars hidden on Android
 * (MainActivity's `VuurtorenScreen`), the window full screen in the computer app (the desktop
 * bridge), and the browser's full screen on the web. Leaving gives everything back. Failures
 * just mean focus mode without full screen.
 */
import { desktopBridge } from "../desktop/bridge.js";

declare global {
  interface Window {
    VuurtorenScreen?: { setImmersive(on: boolean): void };
  }
}

export function setFullScreen(on: boolean): void {
  try {
    if (window.VuurtorenScreen) {
      window.VuurtorenScreen.setImmersive(on);
      return;
    }
    const desk = desktopBridge();
    if (desk?.fullscreen) {
      void desk.fullscreen(on).catch(() => {});
      return;
    }
    if (on && !document.fullscreenElement)
      void document.documentElement.requestFullscreen?.().catch(() => {});
    else if (!on && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  } catch {
    // No full screen here: focus mode still hides the bars.
  }
}

/**
 * In a browser, leaving full screen another way (the browser's own Esc) calls `onLeft`, so
 * focus mode ends with it. Returns the clean-up.
 */
export function onFullScreenLeft(onLeft: () => void): () => void {
  if (window.VuurtorenScreen || desktopBridge()?.fullscreen) return () => {};
  const changed = () => {
    if (!document.fullscreenElement) onLeft();
  };
  document.addEventListener("fullscreenchange", changed);
  return () => document.removeEventListener("fullscreenchange", changed);
}
