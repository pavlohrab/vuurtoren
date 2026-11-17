/**
 * Writing new vocabulary to Anki (the only write the app does — ADR 0003).
 * Uses a dedicated note type so app-created cards are recognisable and well formatted.
 */
import { AnkiConnectError, type AnkiConnectClient } from "./client.js";

export const NOTE_TYPE = "Kenning Word";
export const NOTE_FIELDS = ["Word", "Gloss", "Sentence", "SentenceTranslation", "Source"] as const;

const CSS = `.card { font-family: "Literata", Georgia, serif; font-size: 22px; line-height: 1.5;
  color: #1F1B16; background: #F8F5EF; text-align: center; padding: 24px; }
.word { font-size: 32px; } .sentence { margin-top: 16px; font-size: 18px; color: #6B6259; }
.sentence b { color: #B5562E; font-weight: 600; } .gloss { font-size: 24px; color: #2F6F6A; }
.source { margin-top: 20px; font-size: 12px; color: #A39A8F; }
.night_mode .card { color: #ECE6DC; background: #181512; }`;

const FRONT = `<div class="word">{{Word}}</div>{{#Sentence}}<div class="sentence">{{Sentence}}</div>{{/Sentence}}`;
const BACK = `{{FrontSide}}<hr id="answer"><div class="gloss">{{Gloss}}</div>
{{#SentenceTranslation}}<div class="sentence">{{SentenceTranslation}}</div>{{/SentenceTranslation}}
{{#Source}}<div class="source">{{Source}}</div>{{/Source}}`;

export async function ensureNoteType(anki: AnkiConnectClient): Promise<void> {
  const models = await anki.invoke<string[]>("modelNames");
  if (models.includes(NOTE_TYPE)) return;
  await anki.invoke("createModel", {
    modelName: NOTE_TYPE,
    inOrderFields: [...NOTE_FIELDS],
    css: CSS,
    cardTemplates: [{ Name: "Recognition", Front: FRONT, Back: BACK }],
  });
}

export interface NewWordNote {
  deck: string;
  /** Headword as it should appear on the card, e.g. "de fiets". */
  word: string;
  gloss?: string;
  /** Sentence with the word, may contain <b>…</b> around it. */
  sentence?: string;
  sentenceTranslation?: string;
  source?: string;
  tags?: string[];
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Bold the first occurrence of `surface` in `sentence` (HTML-escaped). */
export function highlightSentence(sentence: string, start: number, end: number): string {
  return `${escapeHtml(sentence.slice(0, start))}<b>${escapeHtml(sentence.slice(start, end))}</b>${escapeHtml(sentence.slice(end))}`;
}

/**
 * Add a vocabulary note. Creates the deck and note type if needed. If an identical word
 * already exists in that deck, returns the existing note id instead of failing.
 */
export async function addWordNote(anki: AnkiConnectClient, note: NewWordNote): Promise<number> {
  await ensureNoteType(anki);
  await anki.invoke("createDeck", { deck: note.deck });
  const fields = {
    Word: escapeHtml(note.word),
    Gloss: escapeHtml(note.gloss ?? ""),
    Sentence: note.sentence ?? "",
    SentenceTranslation: escapeHtml(note.sentenceTranslation ?? ""),
    Source: escapeHtml(note.source ?? ""),
  };
  try {
    return await anki.invoke<number>("addNote", {
      note: {
        deckName: note.deck,
        modelName: NOTE_TYPE,
        fields,
        tags: ["kenning", ...(note.tags ?? [])],
        options: { allowDuplicate: false, duplicateScope: "deck" },
      },
    });
  } catch (e) {
    if (e instanceof AnkiConnectError && /duplicate/i.test(e.message)) {
      const query = `"deck:${note.deck.replace(/[\\"*_]/g, (c) => `\\${c}`)}" "note:${NOTE_TYPE}" "Word:${fields.Word.replace(/[\\"*_:]/g, (c) => `\\${c}`)}"`;
      const [existing] = await anki.findNotes(query);
      if (existing !== undefined) return existing;
    }
    throw e;
  }
}
