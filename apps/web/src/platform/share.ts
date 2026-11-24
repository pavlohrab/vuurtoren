/**
 * Share to Vuurtoren (Android): a text or a link shared from another app (the browser, a news
 * app, a message) opens Add text with it filled in. The app (MainActivity.kt) keeps the shared
 * text until the page takes it with `window.VuurtorenShare.take()`, at start and again when
 * `window.__vuurtorenShare` is called (shared while the app was open).
 */

declare global {
  interface Window {
    VuurtorenShare?: { take(): string };
    __vuurtorenShare?: () => void;
  }
}

/** What was shared: a web page to fetch, or a text to paste. */
export type Shared = { kind: "url"; url: string } | { kind: "paste"; text: string };

/** Longest text around a link that is still just its title ("Title https://…"). */
const TITLE_AROUND_LINK = 200;

/**
 * A link with at most a title around it is a web page ("Kabinet valt https://nos.nl/…"); any
 * other text is pasted as it is.
 */
export function parseShared(raw: string): Shared | null {
  const text = raw.trim();
  if (!text) return null;
  const links = text.match(/https?:\/\/[^\s<>"]+/g) ?? [];
  if (links.length === 1) {
    const rest = text.replace(links[0]!, "").trim();
    if (rest.length <= TITLE_AROUND_LINK)
      return { kind: "url", url: links[0]!.replace(/[).,]+$/, "") };
  }
  return { kind: "paste", text };
}

/** The last shared text, by the id Add text was opened with (reading it changes nothing). */
let last: { id: string; shared: Shared } | null = null;

/** What was shared for Add text opened with `id`, or null. */
export function sharedFor(id: string | undefined): Shared | null {
  return id && last?.id === id ? last.shared : null;
}

/**
 * Take what was shared now and whenever more comes, and `open` Add text for it with an id
 * (Add text reads it with `sharedFor`). Nothing outside the Android app.
 */
export function installShare(open: (s: Shared, id: string) => void): () => void {
  const source = window.VuurtorenShare;
  if (!source) return () => undefined;
  let n = 0;
  const take = () => {
    let raw: string;
    try {
      raw = source.take();
    } catch {
      return;
    }
    const shared = parseShared(raw);
    if (!shared) return;
    const id = `${Date.now()}-${++n}`;
    last = { id, shared };
    open(shared, id);
  };
  window.__vuurtorenShare = take;
  take();
  return () => {
    if (window.__vuurtorenShare === take) delete window.__vuurtorenShare;
  };
}
