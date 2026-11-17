import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Handlers } from "./handlers.js";

/** Wrap a handler result (or error) as an MCP tool result. */
async function respond(run: () => Promise<unknown>) {
  try {
    const data = await run();
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
  }
}

/** Register the Kenning tools on a new MCP server. */
export function buildServer(h: Handlers): McpServer {
  const server = new McpServer({ name: "kenning", version: "0.1.0" });

  server.registerTool(
    "get_known_words",
    {
      description:
        "List Dutch words the learner knows (or is learning). Use it to keep your Dutch within their vocabulary.",
      inputSchema: {
        lang: z.string().optional().describe('Language code, default "nl"'),
        limit: z.number().int().min(1).max(500).optional().describe("Max words, default 100"),
        query: z.string().optional().describe("Only words starting with this prefix"),
        state: z.enum(["known", "learning", "seen", "unknown"]).optional(),
      },
    },
    (a) => respond(() => h.getKnownWords(a)),
  );

  server.registerTool(
    "check_coverage",
    {
      description:
        "Check what share of the words in a Dutch text the learner knows (target 95-98%) and list the words they do not know. Rewrite and re-check when coverage is low.",
      inputSchema: { text: z.string().describe("Dutch text to check") },
    },
    (a) => respond(() => h.checkCoverage(a)),
  );

  server.registerTool(
    "list_texts",
    { description: "List the texts in the learner's library.", inputSchema: {} },
    () => respond(() => h.listTexts()),
  );

  server.registerTool(
    "get_text",
    {
      description: "Read one text from the learner's library by id.",
      inputSchema: { id: z.string().describe("Text id from list_texts") },
    },
    (a) => respond(() => h.getText(a)),
  );

  server.registerTool(
    "add_to_anki",
    {
      description:
        "Add a new Dutch word to the learner's Anki deck. Only use it for words the learner asked to keep.",
      inputSchema: {
        word: z.string().describe("Headword in dictionary form, e.g. 'de fiets'"),
        gloss: z.string().describe("Short English meaning"),
        sentence: z.string().describe("A short Dutch example sentence"),
      },
    },
    (a) => respond(() => h.addToAnki(a)),
  );

  return server;
}
