import type { Account, ServerHealth } from "../auth/client.js";
import { writeLocal } from "./local.js";

/**
 * What the page opens with. Every page keeps its own data in this browser; a page served by a
 * Vuurtoren server also signs in to it (for its sync place and language server), and asks for
 * the sign-in first when the server wants one.
 */
export type Startup =
  | { kind: "demo" }
  /** `server`: the Vuurtoren server this page comes from, when one answered. */
  | { kind: "browser"; server: { health: ServerHealth; account: Account } | null }
  | { kind: "signin"; health: ServerHealth };

export interface StartupDeps {
  demo: boolean;
  /** GET /api/health (null: no Vuurtoren server answered). */
  probe: () => Promise<ServerHealth | null>;
  /** GET /api/auth/me (null: 401, not signed in). */
  me: () => Promise<Account | null>;
}

const OPEN: Account = { authEnabled: false, user: null, via: "open" };

export async function decideStartup(d: StartupDeps): Promise<Startup> {
  if (d.demo) return { kind: "demo" };
  const health = await d.probe();
  // No server, or one that is down: the data is here, so the app opens all the same.
  if (!health) return { kind: "browser", server: null };
  if (!health.authRequired) return { kind: "browser", server: { health, account: OPEN } };
  let account: Account | null;
  try {
    account = await d.me();
  } catch {
    return { kind: "browser", server: null };
  }
  return account ? { kind: "browser", server: { health, account } } : { kind: "signin", health };
}

/** Sessions are cookies: drop an access token an older page kept here. */
export function forgetLegacyToken(): void {
  writeLocal("vuurtoren-token", null);
}
