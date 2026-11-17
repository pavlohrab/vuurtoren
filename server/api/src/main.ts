/**
 * Entry point. Environment:
 *   KENNING_DB     database file (default /data/kenning.sqlite)
 *   KENNING_HOST   bind address (default 127.0.0.1; the container sets 0.0.0.0)
 *   KENNING_PORT   port (default 8787)
 *   KENNING_TOKEN  optional bearer token; leave unset on a trusted network or localhost
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApiServer } from "./server.js";
import { openStore } from "./store.js";

const dbPath = process.env["KENNING_DB"] ?? "/data/kenning.sqlite";
const host = process.env["KENNING_HOST"] ?? "127.0.0.1";
const port = Number(process.env["KENNING_PORT"] ?? 8787);
const token = process.env["KENNING_TOKEN"];

mkdirSync(dirname(dbPath), { recursive: true });
const store = await openStore(dbPath);
const server = createApiServer({ store, token });
server.listen(port, host, () => {
  console.log(
    `[kenning-api] ${dbPath} on http://${host}:${port} (${store.state}, auth ${token ? "on" : "off"})`,
  );
});

const stop = (): void => {
  server.close();
  void store.close().then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
