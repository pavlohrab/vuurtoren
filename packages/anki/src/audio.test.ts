import { readFileSync } from "node:fs";
import type { NativeNote } from "@app/core";
import { describe, expect, it } from "vitest";
import { type ClipKind, clipId, noteClipIds, withClipSounds, wordClipText } from "./audio.js";

/** The same cases server/nlp/tests/test_audio.py checks against the TTS script. */
const FIXTURE = JSON.parse(
  readFileSync(
    new URL("../../../server/nlp/tests/fixtures/audio-ids.json", import.meta.url),
    "utf8",
  ),
) as { cases: { kind: ClipKind; text: string; id: string }[] };

describe("audio clip ids", () => {
  it("match the Python script's ids", async () => {
    expect(FIXTURE.cases.length).toBeGreaterThan(3);
    for (const c of FIXTURE.cases) expect(await clipId(c.kind, c.text)).toBe(c.id);
  });

  it("say nouns with their article, once", () => {
    expect(wordClipText("huis", "het")).toBe("het huis");
    expect(wordClipText("het huis", "het")).toBe("het huis");
    expect(wordClipText("idee", "de/het")).toBe("de/het idee");
    expect(wordClipText("lopen")).toBe("lopen");
  });

  it("prefer a note's stored ids to ones from its text", async () => {
    expect(await noteClipIds({ audio: "word-1", sentence: "Hoe gaat het met je?" }, "x")).toEqual({
      word: "word-1",
      sentence: "sentence-be108d8171b5575c",
    });
    expect(await noteClipIds({ article: "het" }, "huis")).toEqual({
      word: "word-7f3acd97cd7cde99",
    });
  });
});

describe("clips in an .apkg export", () => {
  const note = (id: number, word: string): NativeNote => ({
    id,
    notetypeId: "vuurtoren-word",
    fields: [word, "gloss", "Hoe gaat het met je?", "", ""],
    tags: [],
    sentence: "Hoe gaat het met je?",
  });

  it("adds [sound:] to word notes whose clips exist, and the clips as media", async () => {
    const pack = new Map([
      ["word-600ccd1b71569232", new Uint8Array([1])],
      ["sentence-be108d8171b5575c", new Uint8Array([2])],
    ]);
    const r = await withClipSounds(
      [note(1, "de"), note(2, "nergens"), { ...note(3, "x"), notetypeId: "other" }],
      async (id) => pack.get(id) ?? null,
      (n) =>
        n.notetypeId === "vuurtoren-word"
          ? { text: n.fields[0]!, field: 0, sentenceField: 2 }
          : null,
    );
    expect(r.notes[0]!.fields[0]).toBe("de[sound:word-600ccd1b71569232.mp3]");
    expect(r.notes[0]!.fields[2]).toBe("Hoe gaat het met je?[sound:sentence-be108d8171b5575c.mp3]");
    expect(r.notes[1]!.fields[0]).toBe("nergens");
    expect(r.notes[2]!.fields[2]).toBe("Hoe gaat het met je?");
    expect(r.media.map((m) => m.name).sort()).toEqual([
      "sentence-be108d8171b5575c.mp3",
      "word-600ccd1b71569232.mp3",
    ]);
  });
});
