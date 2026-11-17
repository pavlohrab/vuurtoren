/**
 * Tool logic of the Kenning MCP server, independent of the MCP transport so it can be tested
 * directly. Data comes from the user's Kenning server through the repository contract
 * (`@app/db/http`), analysis from the NLP server, cards go to AnkiConnect.
 */
import { coverageReport } from "@app/ai";
import { type AnkiConnectClient, addWordToAnki } from "@app/anki";
import { type AnalyzedToken, defaultProfile, wordKey } from "@app/core";
import type { KenningRepository } from "@app/db";

export interface McpDeps {
  /** The user's data (HTTP repository against /api/rpc), including the language profile. */
  repo: Pick<
    KenningRepository,
    "words" | "learnerModel" | "listTexts" | "getText" | "append" | "languageProfile"
  >;
  /** Tokenise Dutch text with the NLP server. */
  analyze(text: string): Promise<AnalyzedToken[]>;
  /** AnkiConnect: new notes go through the shared add command (ADR 0010). */
  anki: AnkiConnectClient;
  /**
   * Deck override (KENNING_DECK). Without it the deck comes from the language profile's MCP
   * destination, or its default deck.
   */
  deck?: string | undefined;
  lang?: string;
}

/** Longest text body returned by get_text (keeps a single tool result a sensible size). */
export const MAX_TEXT_CHARS = 20_000;
const MAX_WORDS = 500;

export function createHandlers(deps: McpDeps) {
  const defaultLang = deps.lang ?? "nl";
  return {
    /** Words the learner knows (or another state), optionally filtered by prefix. */
    async getKnownWords(args: {
      lang?: string | undefined;
      limit?: number | undefined;
      query?: string | undefined;
      state?: "known" | "learning" | "seen" | "unknown" | undefined;
    }) {
      const limit = Math.min(Math.max(1, args.limit ?? 100), MAX_WORDS);
      const words = await deps.repo.words(args.lang ?? defaultLang, {
        state: args.state ?? "known",
        limit,
        ...(args.query ? { query: args.query } : {}),
      });
      return {
        count: words.length,
        words: words.map((w) => ({
          word: w.key,
          state: w.state,
          ...(w.gloss ? { gloss: w.gloss } : {}),
        })),
      };
    },

    /** Share of words in `text` the learner knows, plus the words they do not. */
    async checkCoverage(args: { text: string; lang?: string | undefined }) {
      if (!args.text.trim()) throw new Error("text is empty");
      const [tokens, model] = await Promise.all([
        deps.analyze(args.text),
        deps.repo.learnerModel(args.lang ?? defaultLang),
      ]);
      const r = coverageReport(tokens, model);
      return {
        coverage: Math.round(r.coverage * 1000) / 1000,
        words: r.words,
        unknownWords: r.unknown,
      };
    },

    async listTexts() {
      const texts = await deps.repo.listTexts();
      return texts.map((t) => ({ id: t.id, title: t.title, words: t.wordCount }));
    },

    async getText(args: { id: string }) {
      const t = await deps.repo.getText(args.id);
      if (!t) throw new Error(`No text with id ${args.id}`);
      const truncated = t.content.length > MAX_TEXT_CHARS;
      return {
        id: t.id,
        title: t.title,
        truncated,
        content: truncated ? t.content.slice(0, MAX_TEXT_CHARS) : t.content,
      };
    },

    /** Create a card (deck from the language profile) and record it in the learner's data. */
    async addToAnki(args: { word: string; gloss: string; sentence: string }) {
      const word = args.word.trim();
      if (!word) throw new Error("word is empty");
      const profile = (await deps.repo.languageProfile(defaultLang)) ?? defaultProfile(defaultLang);
      const { noteId, deck } = await addWordToAnki(deps.anki, (e) => deps.repo.append(e), {
        profile,
        context: { source: "mcp", ...(deps.deck ? { deck: deps.deck } : {}) },
        word,
        gloss: args.gloss,
        sentence: args.sentence,
        source: "Kenning MCP",
      });
      return { noteId, deck };
    },
  };
}

export type Handlers = ReturnType<typeof createHandlers>;

/** The learner-model key for a headword the model passed (the shared rule, `wordKey`). */
export function headwordKey(word: string, lang = "nl"): string {
  return wordKey(lang, word);
}
