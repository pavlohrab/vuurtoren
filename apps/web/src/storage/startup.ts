import type { ServerHealth } from "@app/db/http";
import type { Account } from "../auth/client.js";

/**
 * What the page should open with. Server mode never silently turns into browser mode: when
 * the server asks for a sign-in the page shows the sign-in screen, and when a server this
 * browser used before does not answer it says so instead of starting an empty local
 * database (which would split the user's data in two).
 */
export type Startup =
  | { kind: "demo" }
  | { kind: "browser" }
  | { kind: "server"; health: ServerHealth; account: Account }
  | { kind: "signin"; health: ServerHealth }
  | { kind: "unreachable"; reason: string };

export interface StartupDeps {
  demo: boolean;
  /** GET /api/health (null: no Kenning API answered). */
  probe: () => Promise<ServerHealth | null>;
  /** GET /api/auth/me (null: 401, not signed in). */
  me: () => Promise<Account | null>;
  /** Did this browser use a server at this address before? */
  serverSeen: () => boolean;
  rememberServer: () => void;
}

const OPEN: Account = { authEnabled: false, user: null, via: "open" };

export async function decideStartup(d: StartupDeps): Promise<Startup> {
  if (d.demo) return { kind: "demo" };
  const health = await d.probe();
  if (!health) {
    return d.serverSeen()
      ? { kind: "unreachable", reason: "The Kenning server at this address did not answer." }
      : { kind: "browser" };
  }
  d.rememberServer();
  if (!health.authRequired) return { kind: "server", health, account: OPEN };
  let account: Account | null;
  try {
    account = await d.me();
  } catch (e) {
    return {
      kind: "unreachable",
      reason: e instanceof Error ? e.message : "The server could not check your sign-in.",
    };
  }
  return account ? { kind: "server", health, account } : { kind: "signin", health };
}

const SERVER_KEY = "kenning-server-seen";

/** Remember that this origin is a Kenning server (so an outage is not mistaken for none). */
export function rememberServer(): void {
  try {
    localStorage.setItem(SERVER_KEY, "1");
  } catch {
    /* storage blocked: an outage would then open browser mode, as before */
  }
}

export function serverSeen(): boolean {
  try {
    return localStorage.getItem(SERVER_KEY) === "1";
  } catch {
    return false;
  }
}

/** The user says this address no longer runs a Kenning server. */
export function forgetServer(): void {
  try {
    localStorage.removeItem(SERVER_KEY);
  } catch {
    /* nothing to forget */
  }
}

/** Sessions are cookies now (ADR 0009): drop the access token older versions kept here. */
export function forgetLegacyToken(): void {
  try {
    localStorage.removeItem("kenning-token");
  } catch {
    /* storage blocked: nothing stored either */
  }
}
