/**
 * `add_to_anki` writes a card through the learner's local AnkiConnect and records it in the
 * learner's data. The other tools live in @app/mcp-tools.
 */
import { type AnkiConnectClient, addWord } from "@app/anki";
import { defaultProfile, wordKey } from "@app/core";
import type { KenningRepository } from "@app/db";

export interface AnkiToolDeps {
  repo: Pick<KenningRepository, "append" | "languageProfile">;
  /** AnkiConnect: new notes go through the shared add command. */
  anki: AnkiConnectClient;
  /**
   * Deck override (KENNING_DECK). Without it the deck comes from the language profile's MCP
   * destination, or its default deck.
   */
  deck?: string | undefined;
  lang?: string;
}

export function createAnkiHandler(deps: AnkiToolDeps) {
  const lang = deps.lang ?? "nl";
  /** Create a card (deck from the language profile) and record it in the learner's data. */
  return async function addToAnki(args: { word: string; gloss: string; sentence: string }) {
    const word = args.word.trim();
    if (!word) throw new Error("word is empty");
    const profile =
      (await deps.repo.languageProfile(lang)) ?? defaultProfile(lang, [], "connected");
    const { noteId, deck } = await addWord(
      async () => deps.anki,
      (e) => deps.repo.append(e),
      {
        profile,
        context: { source: "mcp", ...(deps.deck ? { deck: deps.deck } : {}) },
        word,
        gloss: args.gloss,
        sentence: args.sentence,
        source: "Kenning MCP",
      },
    );
    return { noteId, deck };
  };
}

export type AddToAnki = ReturnType<typeof createAnkiHandler>;

/** The learner-model key for a headword the model passed (the shared rule, `wordKey`). */
export function headwordKey(word: string, lang = "nl"): string {
  return wordKey(lang, word);
}
