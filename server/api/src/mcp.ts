/**
 * `/api/mcp`: the Vuurtoren MCP tools over Streamable HTTP, so Claude Code (or Claude Desktop, or
 * any MCP client) can use the learner's data under the user's own subscription:
 *
 *   claude mcp add --transport http vuurtoren https://<host>/api/mcp \
 *     --header "Authorization: Bearer <MCP token from Settings → AI>"
 *
 * Stateless: every POST gets a fresh MCP server and transport (no session to keep), answers
 * are plain JSON. Tools read and write through the server's own repository queue, exactly like
 * `/api/rpc`. Nothing here talks to Anki: words are only suggested.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AnalyzedToken } from "@app/core";
import type { VuurtorenRepository } from "@app/db";
import { NlpClient } from "@app/nlp-client";
import { createVuurtorenMcpServer, createToolHandlers, type ToolRepo } from "@app/mcp-tools";
import { HttpFail, readBody } from "./http-util.js";
import type { Store } from "./store.js";

/** Largest MCP request body (save_text carries a whole text). */
const MAX_MCP_BYTES = 1024 * 1024;

export interface McpEndpointOptions {
  store: Store;
  /** Tokenise text (the NLP service); without it coverage tools explain that it is missing. */
  analyze?: ((text: string) => Promise<AnalyzedToken[]>) | undefined;
}

/** The repository methods the tools use, each run through the store's queue. */
function queuedRepo(store: Store): ToolRepo {
  const via =
    <K extends keyof ToolRepo>(name: K) =>
    (...args: Parameters<ToolRepo[K]>) =>
      store.withRepo((repo: VuurtorenRepository) =>
        (repo[name] as (...a: unknown[]) => Promise<unknown>).apply(repo, args),
      ) as ReturnType<ToolRepo[K]>;
  return {
    append: via("append"),
    courseBlocks: via("courseBlocks"),
    courses: via("courses"),
    getText: via("getText"),
    getTexts: via("getTexts"),
    learnerModel: via("learnerModel"),
    listTexts: via("listTexts"),
    saveTextAnalysis: via("saveTextAnalysis"),
    staircase: via("staircase"),
    suggestedWords: via("suggestedWords"),
    unitExercises: via("unitExercises"),
    unitWords: via("unitWords"),
    words: via("words"),
    wordsByKeys: via("wordsByKeys"),
  };
}

/** NLP analysis through the NLP service (`VUURTOREN_NLP_URL`), for the API process. */
export function nlpAnalyzer(url: string): (text: string) => Promise<AnalyzedToken[]> {
  const client = new NlpClient({ url, timeoutMs: 60_000 });
  return async (text) =>
    ((await client.analyzeText("nl", [text]))[0]?.tokens ?? []) as AnalyzedToken[];
}

/** Handle one request to `/api/mcp` (the caller has authenticated it). */
export function createMcpEndpoint(opts: McpEndpointOptions) {
  const repo = queuedRepo(opts.store);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body: unknown;
    if (req.method === "POST") {
      try {
        body = JSON.parse((await readBody(req, MAX_MCP_BYTES)).toString("utf8"));
      } catch (err) {
        if (err instanceof HttpFail) throw err;
        throw new HttpFail(400, "Body must be JSON.");
      }
    }
    const handlers = createToolHandlers({ repo, analyze: opts.analyze });
    const server = createVuurtorenMcpServer(handlers);
    // No sessionIdGenerator: stateless mode.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}
