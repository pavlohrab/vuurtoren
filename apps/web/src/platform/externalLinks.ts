/**
 * Links out of the app on Android. Every outside link (Support, the dictionary sites, story
 * credits, docs) opens in a new tab with target="_blank", and the Android WebView ignores that,
 * so on the phone they did nothing. The app (MainActivity.kt) offers `window.VuurtorenLinks`;
 * this hands such clicks to it, and Android opens the phone's browser. The desktop opens them
 * itself (lib.rs `on_new_window`), and in a browser nothing changes.
 */

declare global {
  interface Window {
    VuurtorenLinks?: { open(url: string): boolean };
  }
}

/** The outside address a click goes to, or null when it is not a new-tab link out. */
export function externalHref(target: EventTarget | null): string | null {
  const a = target instanceof Element ? target.closest("a[href]") : null;
  if (!(a instanceof HTMLAnchorElement) || a.target !== "_blank") return null;
  return /^(https?|mailto):/i.test(a.href) ? a.href : null;
}

/** Send new-tab links to the phone's browser; nothing outside the Android app. */
export function installExternalLinks(): void {
  const links = window.VuurtorenLinks;
  if (!links) return;
  document.addEventListener("click", (e) => {
    const href = externalHref(e.target);
    if (href && links.open(href)) e.preventDefault();
  });
}
