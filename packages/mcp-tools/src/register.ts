import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolHandlers } from "./handlers.js";

/** Wrap a handler result (or error) as an MCP tool result (compact JSON). */
export async function respond(run: () => Promise<unknown>) {
  try {
    const data = await run();
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
  }
}

const SERVER_INSTRUCTIONS = `Kenning is the learner's Dutch reading app. Use these tools to keep what you write at the learner's level:
- Before writing Dutch for the learner, look at get_words_to_learn and get_known_words; afterwards run check_coverage (aim for 95-98%) and rewrite unknown words.
- save_text puts a story, dialogue or exercise you wrote into their Kenning Library.
- Never claim you added cards to Anki: suggest_words_for_anki only queues words; the learner confirms them in Kenning.`;

/** A new MCP server named "kenning" with the shared tools registered. */
export function createKenningMcpServer(h: ToolHandlers, version = "0.2.0"): McpServer {
  const server = new McpServer({ name: "kenning", version }, { instructions: SERVER_INSTRUCTIONS });
  registerKenningTools(server, h);
  return server;
}

/** Register the shared Kenning tools on `server`. */
function registerKenningTools(server: McpServer, h: ToolHandlers): void {
  server.registerTool(
    "get_known_words",
    {
      description:
        "List Dutch words the learner knows (or is learning / has seen). Use it to keep your Dutch within their vocabulary.",
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().describe("Max words, default 100"),
        query: z.string().optional().describe("Only words starting with this prefix"),
        state: z
          .enum(["known", "learning", "seen", "unknown"])
          .optional()
          .describe('Default "known"; "learning" = cards the learner is learning in Anki'),
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
    {
      description: "List the texts in the learner's Kenning Library (id, title, words).",
      inputSchema: {},
    },
    () => respond(() => h.listTexts()),
  );

  server.registerTool(
    "get_text",
    {
      description: "Read one text from the learner's Library by id (long texts are truncated).",
      inputSchema: { id: z.string().describe("Text id from list_texts") },
    },
    (a) => respond(() => h.getText(a)),
  );

  server.registerTool(
    "get_words_to_learn",
    {
      description:
        "The words Kenning highlights for the learner to learn next (the amber 'to learn' words of their Library texts), with a sentence each. Good targets for stories and quizzes.",
      inputSchema: {
        textId: z.string().optional().describe("Only this text (default: recent texts)"),
        limit: z.number().int().min(1).max(200).optional().describe("Max words, default 40"),
      },
    },
    (a) => respond(() => h.getWordsToLearn(a)),
  );

  server.registerTool(
    "list_courses",
    {
      description: "List the learner's courses (imported textbooks) and their units.",
      inputSchema: {},
    },
    () => respond(() => h.listCourses()),
  );

  server.registerTool(
    "get_unit",
    {
      description:
        "One unit of a course: its words (with the learner's state), grammar topics, grammar notes and reading texts. Use for 'quiz me on Thema 3'.",
      inputSchema: {
        unit: z
          .union([z.number().int(), z.string()])
          .describe('Unit number or (part of) its title, e.g. 3 or "Thema 3"'),
        courseId: z.string().optional().describe("Course id or title (default: newest course)"),
        includeTexts: z
          .boolean()
          .optional()
          .describe("Also return the unit's reading texts (each up to 4000 characters)"),
      },
    },
    (a) => respond(() => h.getUnit(a)),
  );

  server.registerTool(
    "get_grammar_topic",
    {
      description:
        "Kenning's grammar pages. Without an id: the list of topics (filter with query). With an id: the explanation the learner sees in the app, so your explanations match it.",
      inputSchema: {
        id: z.string().optional().describe("Topic id from the list"),
        query: z.string().optional().describe("Filter the list, e.g. 'perfect' or 'word order'"),
      },
    },
    (a) => respond(() => h.getGrammarTopic(a)),
  );

  server.registerTool(
    "save_text",
    {
      description:
        "Save a Dutch text you wrote (story, dialogue, exercise) to the learner's Kenning Library, where they read it with Kenning's reader. Check coverage first.",
      inputSchema: {
        title: z.string().describe("Short title"),
        content: z.string().describe("The Dutch text (plain text; blank lines between paragraphs)"),
        topic: z.string().optional().describe("What it is about, e.g. 'cycling'"),
        targets: z.array(z.string()).optional().describe("Words the text was meant to practise"),
        grammarTopic: z.string().optional().describe("Grammar topic id it features"),
      },
    },
    (a) => respond(() => h.saveText(a)),
  );

  server.registerTool(
    "suggest_words_for_anki",
    {
      description:
        "Suggest words for the learner's Anki deck. Does NOT add cards: the words wait in Kenning (Words → Suggested by Claude) until the learner adds or dismisses them. Skips words already known or in Anki.",
      inputSchema: {
        words: z
          .array(
            z.object({
              word: z.string().describe("Dictionary form with article for nouns, e.g. 'de fiets'"),
              gloss: z.string().optional().describe("Short English meaning"),
              sentence: z.string().optional().describe("A short Dutch example sentence"),
            }),
          )
          .min(1)
          .max(30),
        note: z.string().optional().describe("Why, e.g. 'from the cycling story'"),
      },
    },
    (a) => respond(() => h.suggestWordsForAnki(a)),
  );
}
