/**
 * Connecting a device to a Vuurtoren server with a pairing code: the server's Settings → Sync →
 * Add a phone shows `vuurtoren://connect?server=<address>&code=<code>` as a QR code and as text;
 * the device scans or pastes it (or types the address and the code), and trades the code at
 * `<server>/api/sync/pair` for a sync token of its own. The passphrase is never in the link.
 */

/** A server and a one-time pairing code. */
export interface ConnectLink {
  /** The server's address, without a trailing slash (`https://vuurtoren.example.org`). */
  server: string;
  /** The pairing code as shown (`ABCDE-FGHJK`). */
  code: string;
  /** "Connect a phone": the computer's certificate SHA-256 (hex), the only one trusted. */
  pinned?: string;
}

/** A server and its user name and password: the device signs in by itself. */
interface ServerSignIn {
  server: string;
  user: string;
  password: string;
}

/** How a device gets its sync token: a pairing code, or signing in. */
export type ServerAccess = ConnectLink | ServerSignIn;

/** The symbols of a code: no 0/O, 1/I/L (server/api/src/auth/tokens.ts). */
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}-?[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}$/;

/** The server's address as typed: https unless it says http, no trailing slash; null if none. */
export function serverAddress(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  // Another scheme (ftp://, vuurtoren://) is not a server's address.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname || u.username || u.password || u.search || u.hash) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** A pairing code as typed: case, spaces and dashes do not matter; null if it cannot be one. */
export function pairingCode(text: string): string | null {
  const t = text.toUpperCase().replace(/[\s-]/g, "");
  return CODE.test(t) ? `${t.slice(0, 5)}-${t.slice(5)}` : null;
}

/** The link a computer shows for its phones: its home-network address, certificate and code. */
export function lanLink(host: string, port: number, cert: string, code: string): string {
  const q = new URLSearchParams({ lan: `${host}:${port}`, cert, code });
  return `vuurtoren://connect?${q.toString()}`;
}

/** The link the server shows for `server` and `code`. */
export function connectLink(server: string, code: string): string {
  const q = new URLSearchParams({ server, code });
  return `vuurtoren://connect?${q.toString()}`;
}

/** A `vuurtoren://connect` link (scanned, pasted or opened), or null when it is not one. */
export function parseConnectLink(text: string): ConnectLink | null {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "vuurtoren:") return null;
  // `vuurtoren://connect?…` parses with "connect" as the host; `vuurtoren:connect?…` as the path.
  const what = (u.host || u.pathname).replace(/^\/+|\/+$/g, "");
  if (what !== "connect") return null;
  const code = pairingCode(u.searchParams.get("code") ?? "");
  // A computer on the home network (`lan=192.168.1.20:47120&cert=<sha256>`).
  const lan = u.searchParams.get("lan") ?? "";
  const cert = (u.searchParams.get("cert") ?? "").toLowerCase();
  if (lan && /^[0-9a-f]{64}$/.test(cert) && /^[\w.-]+:\d{1,5}$/.test(lan))
    return code ? { server: `https://${lan}`, code, pinned: cert } : null;
  const server = serverAddress(u.searchParams.get("server") ?? "");
  return server && code ? { server, code } : null;
}

/** The name the server lists the token under: "Phone (Pixel 8)" on a phone, else the name. */
export function pairedLabel(deviceName: string, userAgent: string, phone: boolean): string {
  const name = deviceName.trim();
  if (!phone) return name.slice(0, 80) || "A device";
  // Android's user agent names the model: "(Linux; Android 14; Pixel 8 Build/…)" or, with
  // reduced user agents, "(Linux; Android 10; K)".
  const model = /Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/.exec(userAgent)?.[1]?.trim();
  const what = model && model !== "K" ? model : name && name !== "Phone" ? name : "";
  return what ? `Phone (${what})`.slice(0, 80) : "Phone";
}

/** What the server answers for a pairing code. */
export interface Paired {
  url: string;
  token: string;
  label: string;
  /** "Connect a phone": the sync key the computer handed over (base64), so no passphrase. */
  key?: string;
}

/** Trade the pairing code for a sync token (`POST <server>/api/sync/pair`). */
/** How long a phone waits for "Is this your phone?" on its computer, and how often it asks. */
const WAIT_MS = 10 * 60_000;
const ASK_EVERY_MS = 1000;

export async function pairWithServer(
  link: ServerAccess,
  label: string,
  fetchImpl: typeof fetch,
  /** The computer asks "Is this your phone?" (SY12): say so on the phone meanwhile. */
  onWait?: () => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Paired> {
  const body =
    "code" in link
      ? { code: link.code, name: label }
      : { user: link.user, password: link.password, name: label };
  let res: Response;
  try {
    res = await fetchImpl(`${link.server}/api/sync/pair`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-vuurtoren": "1" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Vuurtoren at ${new URL(link.server).host} cannot be reached. Check the address and that this device is online.`,
    );
  }
  type Answer = {
    token?: string;
    label?: string;
    error?: string;
    waiting?: string;
    handover?: { key?: string };
  };
  let answer = (await res.json().catch(() => ({}))) as Answer;
  // The user's computer asks "Is this your phone?" before anything goes (SY12): ask again
  // until it says yes or no.
  if (res.status === 202 && answer.waiting) {
    onWait?.();
    const id = answer.waiting;
    const until = Date.now() + WAIT_MS;
    while (res.status === 202 && Date.now() < until) {
      await wait(ASK_EVERY_MS);
      try {
        res = await fetchImpl(`${link.server}/api/sync/pair/wait`, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json", "x-vuurtoren": "1" },
          body: JSON.stringify({ waiting: id }),
        });
      } catch {
        throw new Error("Your phone lost the computer while it waited. Scan the code again.");
      }
      answer = (await res.json().catch(() => ({}))) as Answer;
    }
    if (res.status === 202) throw new Error("No answer from the computer. Scan the code again.");
  }
  if (res.status === 404) {
    throw new Error(
      `${new URL(link.server).host} does not answer like a Vuurtoren server that can pair devices. Check the address, or update the server.`,
    );
  }
  if (!res.ok || !answer.token) {
    throw new Error(answer.error ?? `The server answered ${res.status}.`);
  }
  return {
    url: link.server,
    token: answer.token,
    label: answer.label ?? label,
    ...(answer.handover?.key ? { key: answer.handover.key } : {}),
  };
}

/** The port a computer listens on for its phones (lan_cmd.rs `PHONE_PORT`). */
const PHONE_PORT = 47120;

/**
 * A typed address of the user's computer on the home network (a private IPv4), as the base to
 * reach it, with its port (47120 unless typed); null for anything else (a server).
 */
export function typedComputer(server: string): string | null {
  try {
    const u = new URL(server);
    const parts = u.hostname.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
      return null;
    const [a, b] = parts as [number, number];
    const home =
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254);
    return home ? `https://${u.hostname}:${u.port || PHONE_PORT}` : null;
  } catch {
    return null;
  }
}

/** HMAC-SHA256 of `message` with `key`, hex (WebCrypto). */
async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The typed code (SY9): the computer at `base` proves it knows `code`, bound to the certificate
 * the phone saw; only then is that certificate trusted. Returns its fingerprint. Someone in
 * between shows another certificate and can't make the proof for it without the code.
 */
export async function proveComputer(
  base: string,
  code: string,
  probe: (base: string, nonce: string) => Promise<{ fingerprint: string; proof: string }>,
): Promise<string> {
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const { fingerprint, proof } = await probe(base, nonce);
  const want = await hmacHex(
    code.replace(/-/g, ""),
    `vuurtoren-pair:${nonce}:${fingerprint.toLowerCase()}`,
  );
  if (!fingerprint || proof !== want) {
    throw new Error(
      "This is not the computer that shows this code, or the code is wrong. Show a new code on your computer and type it again.",
    );
  }
  return fingerprint.toLowerCase();
}
