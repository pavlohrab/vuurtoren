import { describe, expect, it } from "vitest";
import { AnkiConnectClient } from "./client.js";
import { NOTE_TYPE, addWordNote, highlightSentence } from "./note.js";

function fake(models: string[], addError?: string) {
  const calls: { action: string; params: Record<string, unknown> }[] = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { action, params } = JSON.parse(String(init?.body)) as {
      action: string;
      params: Record<string, unknown>;
    };
    calls.push({ action, params });
    const result =
      action === "modelNames"
        ? models
        : action === "addNote"
          ? addError
            ? null
            : 777
          : action === "findNotes"
            ? [555]
            : null;
    const error = action === "addNote" && addError ? addError : null;
    return new Response(JSON.stringify({ result, error }));
  }) as typeof fetch;
  return { anki: new AnkiConnectClient({ fetch: f }), calls };
}

describe("addWordNote", () => {
  it("creates note type and deck, escapes fields, tags notes", async () => {
    const { anki, calls } = fake([]);
    const id = await addWordNote(anki, {
      deck: "Kenning::NL",
      word: "de <fiets>",
      gloss: "bike",
      sentence: "De <b>fiets</b> is rood.",
    });
    expect(id).toBe(777);
    expect(calls.map((c) => c.action)).toEqual([
      "modelNames",
      "createModel",
      "createDeck",
      "addNote",
    ]);
    const note = calls[3]!.params["note"] as {
      fields: Record<string, string>;
      tags: string[];
      modelName: string;
    };
    expect(note.modelName).toBe(NOTE_TYPE);
    expect(note.fields["Word"]).toBe("de &lt;fiets&gt;");
    expect(note.fields["Sentence"]).toBe("De <b>fiets</b> is rood.");
    expect(note.tags).toContain("kenning");
  });

  it("skips createModel when the note type exists and returns the existing id on duplicates", async () => {
    const { anki, calls } = fake([NOTE_TYPE], "cannot create note because it is a duplicate");
    expect(await addWordNote(anki, { deck: "NL", word: "fiets" })).toBe(555);
    expect(calls.map((c) => c.action)).toEqual([
      "modelNames",
      "createDeck",
      "addNote",
      "findNotes",
    ]);
  });
});

describe("highlightSentence", () => {
  it("bolds the span and escapes HTML", () => {
    expect(highlightSentence("Ik bel <je> op", 3, 6)).toBe("Ik <b>bel</b> &lt;je&gt; op");
  });
});

describe("onlyBoldTags", () => {
  it("keeps <b> and neutralises other markup", async () => {
    const { onlyBoldTags } = await import("./note.js");
    expect(onlyBoldTags("Ik <b>fiets</b> &amp; jij")).toBe("Ik <b>fiets</b> &amp; jij");
    expect(onlyBoldTags('<img src=x onerror="a()">')).toBe('&lt;img src=x onerror="a()">');
  });
});
