#!/usr/bin/env node
/**
 * Kenning MCP server (stdio). Lets Claude Desktop / Claude Code (or any MCP client) read the
 * learner's data under the user's own subscription: no keys, no OAuth handling here. It opens
 * the desktop app's own database on this computer (see dbPath.ts and localData.ts).
 *
 * Environment:
 *   KENNING_DB         the desktop app's data file (default: where the app keeps it)
 *   KENNING_NLP_URL    language server for check_coverage and save_text, e.g. your Kenning
 *                      server's https://kenning.example.com/nlp (optional)
 *   KENNING_NLP_TOKEN  sent as a bearer token to KENNING_NLP_URL (a sync token of that server)
 *   KENNING_ANKI_URL   AnkiConnect (default http://127.0.0.1:8765); KENNING_ANKI_KEY if set
 *   KENNING_DECK       deck override; by default the language profile decides (its MCP
 *                      destination, else its default deck)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AnkiConnectClient } from "@app/anki";
import { NlpClient } from "@app/nlp-client";
import { createToolHandlers } from "@app/mcp-tools";
import { desktopDbPath } from "./dbPath.js";
import { createAnkiHandler } from "./handlers.js";
import { openLocalData } from "./localData.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const env = process.env;
  const db = desktopDbPath();
  const { repo } = await openLocalData(db.path);
  const nlpUrl = env["KENNING_NLP_URL"]?.replace(/\/$/, "");
  const nlpToken = env["KENNING_NLP_TOKEN"];
  // The token goes to the language server's own address only.
  const nlpFetch: typeof fetch = (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    if (!nlpToken || !nlpUrl || !target.startsWith(`${nlpUrl}/`)) return fetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${nlpToken}`);
    return fetch(input, { ...init, headers });
  };
  const nlp = nlpUrl ? new NlpClient({ url: nlpUrl, fetch: nlpFetch }) : null;
  const ankiKey = env["KENNING_ANKI_KEY"];
  const anki = new AnkiConnectClient({
    url: env["KENNING_ANKI_URL"] ?? "http://127.0.0.1:8765",
    ...(ankiKey ? { apiKey: ankiKey } : {}),
  });
  const handlers = createToolHandlers({
    repo,
    analyze: nlp
      ? async (text) => (await nlp.analyzeText("nl", [text]))[0]?.tokens ?? []
      : undefined,
  });
  const addToAnki = createAnkiHandler({ repo, anki, deck: env["KENNING_DECK"] });
  await buildServer(handlers, addToAnki).connect(new StdioServerTransport());
  // stdout carries the protocol; log to stderr only.
  console.error(`kenning-mcp ready (${db.path}, from ${db.from})`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
