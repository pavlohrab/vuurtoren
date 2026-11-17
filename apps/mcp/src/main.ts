#!/usr/bin/env node
/**
 * Kenning MCP server (stdio). Lets Claude Desktop / Claude Code (or any MCP client) read the
 * learner's data under the user's own subscription (ADR 0005): no keys, no OAuth handling here.
 *
 * Environment:
 *   KENNING_URL        base URL of the Kenning server (required), e.g. http://localhost:8080
 *   KENNING_TOKEN      bearer token if the server requires one
 *   KENNING_NLP_URL    NLP server (default: $KENNING_URL/nlp)
 *   KENNING_ANKI_URL   AnkiConnect (default http://127.0.0.1:8765); KENNING_ANKI_KEY if set
 *   KENNING_DECK       target deck (default Kenning::Nederlands)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AnkiConnectClient, addWordNote } from "@app/anki";
import { createHttpRepository } from "@app/db/http";
import { NlpClient } from "@app/nlp-client";
import { createHandlers } from "./handlers.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const env = process.env;
  const url = env["KENNING_URL"]?.replace(/\/$/, "");
  if (!url) {
    console.error("KENNING_URL is not set (the address of your Kenning server, server mode).");
    process.exit(1);
  }
  const repo = await createHttpRepository(url, env["KENNING_TOKEN"]);
  const nlp = new NlpClient({ url: env["KENNING_NLP_URL"] ?? `${url}/nlp` });
  const ankiKey = env["KENNING_ANKI_KEY"];
  const anki = new AnkiConnectClient({
    url: env["KENNING_ANKI_URL"] ?? "http://127.0.0.1:8765",
    ...(ankiKey ? { apiKey: ankiKey } : {}),
  });
  const handlers = createHandlers({
    repo,
    deck: env["KENNING_DECK"] ?? "Kenning::Nederlands",
    analyze: async (text) => (await nlp.analyzeText("nl", [text]))[0]?.tokens ?? [],
    addNote: (n) =>
      addWordNote(anki, {
        deck: n.deck,
        word: n.word,
        ...(n.gloss ? { gloss: n.gloss } : {}),
        ...(n.sentence ? { sentence: n.sentence } : {}),
        tags: ["nl", "mcp"],
        source: "Kenning MCP",
      }),
  });
  await buildServer(handlers).connect(new StdioServerTransport());
  // stdout carries the protocol; log to stderr only.
  console.error("kenning-mcp ready");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
