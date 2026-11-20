/**
 * Entry point.
 *
 *   node dist/main.js                 run the server
 *   node dist/main.js hash-password   print a VUURTOREN_PASSWORD_HASH (see auth/cli.ts)
 *
 * Environment:
 *   VUURTOREN_DB     database file (default /data/vuurtoren.sqlite)
 *   VUURTOREN_HOST   bind address (default 127.0.0.1; the container sets 0.0.0.0)
 *   VUURTOREN_PORT   port (default 8787)
 *   VUURTOREN_NLP_URL  NLP service for the MCP endpoint's text analysis (e.g. http://nlp:8000)
 *   VUURTOREN_SYNC_QUOTA_MB  most space all sync files together may take (default 2048)
 *   Sign-in: VUURTOREN_USER, VUURTOREN_PASSWORD_HASH (or VUURTOREN_PASSWORD),
 *   VUURTOREN_TOKEN, VUURTOREN_AUTH_DB, VUURTOREN_COOKIE_SECURE, VUURTOREN_TRUST_CF,
 *   VUURTOREN_ALLOWED_ORIGINS; see auth/config.ts. With no password and no token, auth is off.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hashPasswordCommand } from "./auth/cli.js";
import { authFromEnv } from "./auth/config.js";
import { createAuth } from "./auth/index.js";
import { createApiServer } from "./server.js";
import { openStore } from "./store.js";

const command = process.argv[2];
if (command === "hash-password") {
  process.exit(await hashPasswordCommand());
} else if (command !== undefined) {
  console.error(`Unknown command "${command}". Commands: hash-password (or none to serve).`);
  process.exit(2);
}

const dbPath = process.env["VUURTOREN_DB"] ?? "/data/vuurtoren.sqlite";
const host = process.env["VUURTOREN_HOST"] ?? "127.0.0.1";
const port = Number(process.env["VUURTOREN_PORT"] ?? 8787);

let config: Awaited<ReturnType<typeof authFromEnv>>;
try {
  config = await authFromEnv(process.env);
} catch (e) {
  console.error(`[vuurtoren-api] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
for (const line of config.log) console.log(`[vuurtoren-api] ${line}`);
for (const line of config.warnings) console.warn(`[vuurtoren-api] WARNING: ${line}`);
const authDb = config.options.sessionDb!;
if (authDb !== ":memory:" && resolve(authDb) === resolve(dbPath)) {
  console.error("[vuurtoren-api] VUURTOREN_AUTH_DB must be a different file from VUURTOREN_DB.");
  process.exit(1);
}

/** VUURTOREN_SYNC_QUOTA_MB in bytes; unset or not a positive number keeps the default. */
function syncQuota(mb: string | undefined): number | undefined {
  const n = Number(mb?.trim() || NaN);
  if (Number.isFinite(n) && n > 0) return Math.floor(n * 1024 * 1024);
  if (mb?.trim()) console.warn(`[vuurtoren-api] WARNING: VUURTOREN_SYNC_QUOTA_MB "${mb}" is ignored.`);
  return undefined;
}

mkdirSync(dirname(dbPath), { recursive: true });
const store = await openStore(dbPath);
const auth = createAuth(config.options);
const server = createApiServer({
  store,
  auth,
  nlpUrl: process.env["VUURTOREN_NLP_URL"] || undefined,
  syncQuotaBytes: syncQuota(process.env["VUURTOREN_SYNC_QUOTA_MB"]),
});
server.listen(port, host, () => {
  console.log(
    `[vuurtoren-api] ${dbPath} on http://${host}:${port} (${store.state}, auth ${auth.enabled ? auth.methods.join("+") : "OFF"})`,
  );
});

const stop = (): void => {
  server.close();
  auth.close();
  void store.close().then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
