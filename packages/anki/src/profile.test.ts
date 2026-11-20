import { defaultProfile, migratedProfile } from "@app/core";
import { describe, expect, it } from "vitest";
import { AnkiConnectClient } from "./client.js";
import type { DetectFn } from "./detect.js";
import { fakeAnki, type FakeNote } from "./fake-anki.test-util.js";
import { fakeAnkiWrite, fakeCollection } from "./fake-anki-write.test-util.js";
import { NOTE_TYPE } from "./note.js";
import { type NoteAddedEvent, addWordToAnki, profileSources } from "./profile.js";
import { buildSnapshot } from "./snapshot.js";

const NL = new Set(["fiets", "lopen", "huis", "boek", "trein", "kat"]);
const detect: DetectFn = async (texts) =>
  texts.map((t) => ({ lang: NL.has(t) ? "nl" : t ? "en" : null, confidence: 0.9 }));
const analyzeTerms = async (terms: string[]) =>
  terms.map((t) => ({ key: t.toLowerCase(), aliases: [], article: null }));

let id = 1;
const note = (deck: string, model: string, fields: Record<string, string>): FakeNote => ({
  id: id++,
  deck,
  model,
  fields,
  cards: [30],
  lastReview: Date.UTC(2026, 10, 1),
});
const notes: FakeNote[] = [
  note("NL", "Woord", { Woord: "fiets", Betekenis: "bike" }),
  note("NL", "Woord", { Woord: "lopen", Betekenis: "walk" }),
  note("Freq", "Freq", { Word: "huis", Definition: "house" }),
  note("Vuurtoren::Nederlands", NOTE_TYPE, {
    Word: "boek",
    Gloss: "book",
    Sentence: "",
    SentenceTranslation: "",
  }),
  note("Course::U1", "Basic", { Front: "trein", Back: "train" }),
  // Detection would reject this deck (headwords look English), but the user confirmed it.
  note("Mixed", "Basic", { Front: "cat", Back: "kat" }),
  ...Array.from({ length: 12 }, () => note("Bio", "Basic", { Front: "enzyme", Back: "protein" })),
];
const base = () => ({
  anki: new AnkiConnectClient({ fetch: fakeAnki(notes) }),
  lang: "nl",
  detect,
  analyzeTerms,
  random: () => 0.5,
});

describe("profileSources", () => {
  it("reads confirmed sources, destination and course decks, never unconfirmed decks", async () => {
    const profile = {
      ...defaultProfile("nl"),
      sources: [
        { deck: "NL" },
        { deck: "Freq", modelName: "Freq", wordField: "Word", glossField: "Definition" },
        { deck: "Mixed" },
        { deck: "Gone" },
      ],
    };
    const sources = await profileSources(base(), profile, ["Course::U1"]);
    const byDeck = new Map(sources.map((s) => [s.deck, s]));
    expect([...byDeck.keys()].sort()).toEqual([
      "Course::U1",
      "Freq",
      "Mixed",
      "NL",
      "Vuurtoren::Nederlands",
    ]);
    expect(byDeck.get("NL")!.wordField).toBe("Woord");
    expect(byDeck.get("Vuurtoren::Nederlands")!.modelName).toBe(NOTE_TYPE);
    expect(byDeck.get("Freq")!.glossField).toBe("Definition");

    const snap = await buildSnapshot(base(), sources);
    const keys = snap.entries.map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(["fiets", "lopen", "huis", "boek", "trein"]));
    expect(keys).not.toContain("enzyme");
  });

  it("an empty profile gives an empty snapshot instead of an error", async () => {
    const sources = await profileSources(base(), {
      ...defaultProfile("nl"),
      destinations: { default: "Nope" },
    });
    expect(sources).toEqual([]);
    const snap = await buildSnapshot(base(), sources);
    expect(snap.entries).toEqual([]);
  });
});

describe("addWordToAnki", () => {
  it("resolves the deck, creates note type and deck, tags, and records one key", async () => {
    const col = fakeCollection([]);
    const anki = new AnkiConnectClient({ fetch: fakeAnkiWrite(col) });
    const events: NoteAddedEvent[] = [];
    const record = async (e: NoteAddedEvent) => void events.push(e);
    const profile = defaultProfile("nl");
    const r = await addWordToAnki(anki, record, {
      profile,
      context: { source: "converse" },
      word: "de fiets",
      gloss: "bike",
    });
    expect(r.deck).toBe("Vuurtoren::Nederlands::Converse");
    expect(col.models.has(NOTE_TYPE)).toBe(true);
    expect(col.decks.has("Vuurtoren::Nederlands::Converse")).toBe(true);
    expect([...col.tags.get(r.noteId)!]).toEqual(["vuurtoren", "nl", "vuurtoren::from::converse"]);
    expect(events).toEqual([
      { type: "NoteAddedToAnki", lang: "nl", key: "fiets", noteId: r.noteId, deck: r.deck },
    ]);

    // Same word again: the existing note is reused.
    const again = await addWordToAnki(anki, record, {
      profile,
      context: { source: "converse" },
      word: "de fiets",
    });
    expect(again.noteId).toBe(r.noteId);

    // Course rule, explicit key, picker override.
    const c = await addWordToAnki(anki, record, {
      profile,
      context: { source: "course", course: { title: "Boek", unitTitle: "Les 1" } },
      word: "het huis",
      key: "Huis",
      extraTags: ["vuurtoren::course::boek::1"],
    });
    expect(c.deck).toBe("Vuurtoren::Nederlands::Boek::Les 1");
    expect(c.key).toBe("huis");
    const p = await addWordToAnki(anki, record, {
      profile: migratedProfile("nl", "Old", []),
      context: { source: "reading", deck: "Picked" },
      word: "lopen",
    });
    expect(p.deck).toBe("Picked");
  });

  it("can add as known (mark known)", async () => {
    const col = fakeCollection([]);
    const anki = new AnkiConnectClient({ fetch: fakeAnkiWrite(col) });
    const r = await addWordToAnki(anki, async () => {}, {
      profile: defaultProfile("nl"),
      context: { source: "reading" },
      word: "kat",
      asKnown: true,
    });
    expect(r.cardIds.length).toBe(1);
    expect(col.tags.get(r.noteId)!.has("vuurtoren::known")).toBe(true);
  });

  it("rejects an empty word", async () => {
    const anki = new AnkiConnectClient({ fetch: fakeAnkiWrite(fakeCollection([])) });
    await expect(
      addWordToAnki(anki, async () => {}, {
        profile: defaultProfile("nl"),
        context: { source: "mcp" },
        word: " ",
      }),
    ).rejects.toThrow(/empty/);
  });
});
