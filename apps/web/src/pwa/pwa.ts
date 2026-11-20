/**
 * Installable app: registers the service worker (sw/sw.js, built builds only), tells the
 * app when a new version is waiting, and keeps the browser's install prompt for Settings.
 */
import { useSyncExternalStore } from "react";

/** Chrome/Edge's `beforeinstallprompt` event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  /** A new version is installed and waits for "Reload". */
  updateReady: boolean;
  /** The browser offers to install the app (Chrome/Edge; not once installed). */
  canInstall: boolean;
}

let state: PwaState = { updateReady: false, canInstall: false };
let waiting: ServiceWorker | null = null;
let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<PwaState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The PWA state for components (update waiting, install offered). */
export function usePwa(): PwaState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Switch to the waiting version; the page reloads once it has taken over. */
export function applyUpdate(): void {
  if (waiting) waiting.postMessage("vuurtoren-sw-update");
  else location.reload();
}

/** Show the browser's install dialog (only after `beforeinstallprompt`). */
export async function promptInstall(): Promise<boolean> {
  const ev = installPrompt;
  if (!ev) return false;
  installPrompt = null;
  set({ canInstall: false });
  await ev.prompt();
  return (await ev.userChoice).outcome === "accepted";
}

/**
 * Listen for the install prompt and register the service worker. Built app only (`vite dev`
 * has no worker), and never inside the desktop shell (Tauri serves its own files).
 */
export function initPwa(): void {
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
    set({ canInstall: true });
  });
  addEventListener("appinstalled", () => {
    installPrompt = null;
    set({ canInstall: false });
  });
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || "__TAURI_INTERNALS__" in window)
    return;
  const sw = navigator.serviceWorker;
  // Reload once when a new version takes over after "Reload" (not on the very first install,
  // when there was no controller before).
  let reloading = false;
  const hadController = sw.controller !== null;
  sw.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  const watch = (reg: ServiceWorkerRegistration): void => {
    const offer = (w: ServiceWorker | null): void => {
      // A waiting worker while another controls the page = an update (not the first install).
      if (w && sw.controller) {
        waiting = w;
        set({ updateReady: true });
      }
    };
    offer(reg.waiting);
    // A tab left open for days still learns about a new version.
    setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed") offer(w);
      });
    });
  };
  const register = (): void => {
    sw.register("/sw.js", { scope: "/" }).then(watch, (e: unknown) => {
      console.warn("Service worker not registered:", e);
    });
  };
  if (document.readyState === "complete") register();
  else addEventListener("load", register, { once: true });
}
