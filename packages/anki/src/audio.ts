/**
 * Spoken words and sentences (the `audio-nl` data pack, made by
 * `server/nlp/scripts/tts_elevenlabs.py`). A clip's id comes from its exact text, as in the
 * script: `word-<sha1(text)[:16]>` for a word ("het huis": a noun with its article) and
 * `sentence-<sha1(text)[:16]>` for an example sentence. So a card finds its clip without a lookup
 * table; starter notes also keep the ids they were made with (`audio`, `sentenceAudio`).
 */
import type { NativeNote } from "@app/core";

export type ClipKind = "word" | "sentence";
export type Voice = "female" | "male";

/**
 * The text a word's clip says: nouns with their article ("het huis", "de/het idee"), also when
 * the word is stored with it already.
 */
export const wordClipText = (word: string, article?: string): string =>
  article && !word.toLowerCase().startsWith(`${article.toLowerCase()} `)
    ? `${article} ${word}`
    : word;

/** The id of the clip of `text` (sha1 of its UTF-8 bytes, first 16 hex digits). */
export async function clipId(kind: ClipKind, text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `${kind}-${hex}`;
}

/** The clip ids of a vocabulary note: the stored ones, else from its word and sentence. */
export async function noteClipIds(
  note: Pick<NativeNote, "audio" | "sentenceAudio" | "sentence" | "article">,
  word: string | undefined,
): Promise<{ word?: string; sentence?: string }> {
  const out: { word?: string; sentence?: string } = {};
  const w = note.audio ?? (word ? await clipId("word", wordClipText(word, note.article)) : null);
  if (w) out.word = w;
  const s = note.sentenceAudio ?? (note.sentence ? await clipId("sentence", note.sentence) : null);
  if (s) out.sentence = s;
  return out;
}

/**
 * For an .apkg export: `[sound:<id>.mp3]` after the word and the sentence fields of the word
 * notes whose clips exist, and those clips as media. `word` gives a note's word and the indexes
 * of its word and sentence fields, or null for notes that are not vocabulary.
 */
export async function withClipSounds(
  notes: readonly NativeNote[],
  clip: (id: string) => Promise<Uint8Array | null>,
  word: (n: NativeNote) => { text: string; field: number; sentenceField?: number } | null,
): Promise<{ notes: NativeNote[]; media: { name: string; bytes: () => Promise<Uint8Array> }[] }> {
  const media = new Map<string, Uint8Array>();
  const out: NativeNote[] = [];
  for (const n of notes) {
    const w = word(n);
    if (!w) {
      out.push(n);
      continue;
    }
    const ids = await noteClipIds(n, w.text);
    const fields = [...n.fields];
    for (const [field, id] of [
      [w.field, ids.word],
      [w.sentenceField, ids.sentence],
    ] as const) {
      if (field === undefined || !id || fields[field] === undefined) continue;
      const bytes = media.get(id) ?? (await clip(id));
      if (!bytes) continue;
      media.set(id, bytes);
      fields[field] += `[sound:${id}.mp3]`;
    }
    out.push({ ...n, fields });
  }
  return {
    notes: out,
    media: [...media].map(([id, bytes]) => ({ name: `${id}.mp3`, bytes: async () => bytes })),
  };
}
