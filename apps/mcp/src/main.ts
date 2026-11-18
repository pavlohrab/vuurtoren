#!/usr/bin/env node
/**
 * Kenning MCP server (stdio). Lets Claude Desktop / Claude Code (or any MCP client) read the
 * learner's data under the user's own subscription (ADR 0005): no keys, no OAuth handling here.
 * Prefer the server's own endpoint (/api/mcp, Settings → AI → Use with Claude Code) when Kenning
 * runs on a server; this stdio server adds `add_to_anki` for a local AnkiConnect.
 *
 * Environment:
 *   KENNING_URL        base URL of the Kenning server (required), e.g. http://localhost:8080
 *   KENNING_TOKEN      bearer token if the server requires one (also sent to $KENNING_URL/nlp)
 *   KENNING_NLP_URL    NLP server (default: $KENNING_URL/nlp)
 *   KENNING_ANKI_URL   AnkiConnect (default http://127.0.0.1:8765); KENNING_ANKI_KEY if set
 *   KENNING_DECK       deck override; by default the language profile decides (its MCP
 *                      destination, else its default deck)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AnkiConnectClient } from "@app/anki";
import { createHttpRepository } from "@app/db/http";
import { NlpClient } from "@app/nlp-client";
import { createToolHandlers } from "@app/mcp-tools";
import { createAnkiHandler } from "./handlers.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const env = process.env;
  const url = env["KENNING_URL"]?.replace(/\/$/, "");
  if (!url) {
    console.error("KENNING_URL is not set (the address of your Kenning server, server mode).");
    process.exit(1);
  }
  const token = env["KENNING_TOKEN"];
  const repo = await createHttpRepository(url, token);
  // The web container gates /nlp behind the same sign-in (ADR 0009): send the token there too,
  // but never to another host.
  const nlpUrl = env["KENNING_NLP_URL"] ?? `${url}/nlp`;
  const nlpFetch: typeof fetch = (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    if (!token || !target.startsWith(`${url}/`)) return fetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  const nlp = new NlpClient({ url: nlpUrl, fetch: nlpFetch });
  const ankiKey = env["KENNING_ANKI_KEY"];
  const anki = new AnkiConnectClient({
    url: env["KENNING_ANKI_URL"] ?? "http://127.0.0.1:8765",
    ...(ankiKey ? { apiKey: ankiKey } : {}),
  });
  const handlers = createToolHandlers({
    repo,
    analyze: async (text) => (await nlp.analyzeText("nl", [text]))[0]?.tokens ?? [],
  });
  const addToAnki = createAnkiHandler({ repo, anki, deck: env["KENNING_DECK"] });
  await buildServer(handlers, addToAnki).connect(new StdioServerTransport());
  // stdout carries the protocol; log to stderr only.
  console.error("kenning-mcp ready");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
