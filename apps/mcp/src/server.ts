import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createVuurtorenMcpServer, respond, type ToolHandlers } from "@app/mcp-tools";
import { z } from "zod";
import type { AddToAnki } from "./handlers.js";

/**
 * The stdio server: the shared Vuurtoren tools plus `add_to_anki` (local AnkiConnect), which
 * the user must ask for explicitly.
 */
export function buildServer(h: ToolHandlers, addToAnki: AddToAnki): McpServer {
  const server = createVuurtorenMcpServer(h);
  server.registerTool(
    "add_to_anki",
    {
      description:
        "Add one Dutch word to the learner's Anki deck right now (local AnkiConnect). Only when the learner explicitly asked to add this word; otherwise use suggest_words_for_anki.",
      inputSchema: {
        word: z.string().describe("Headword in dictionary form, e.g. 'de fiets'"),
        gloss: z.string().describe("Short English meaning"),
        sentence: z.string().describe("A short Dutch example sentence"),
      },
    },
    (a) => respond(() => addToAnki(a)),
  );
  return server;
}
