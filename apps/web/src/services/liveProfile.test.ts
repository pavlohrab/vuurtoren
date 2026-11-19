import { AnkiConnectClient, addWordToAnki } from "@app/anki";
import { defaultProfile } from "@app/core";
import { type KenningRepository, createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import type { NlpClient } from "@app/nlp-client";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveProfile } from "./liveProfile.js";
import { DEFAULT_SETTINGS } from "./liveSettings.js";
import type { Settings } from "./types.js";

interface Note {
  deck: string;
  model: string;
  fields: Record<string, string>;
}

/** A tiny AnkiConnect: reads plus addNote / createDeck / createModel, writes are recorded. */
function fakeAnki(notes: Map<number, Note>) {
  const calls: { action: string; params: Record<string, unknown> }[] = [];
  let next = 500;
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/api/v1")) return new Response("{}", { status: 404 });
    const { action, params = {} } = JSON.parse(String(init?.body)) as {
      action: string;
      params?: Record<string, unknown>;
    };
    calls.push({ action, params });
    const result = (() => {
      switch (action) {
        case "deckNames":
          return [...new Set([...notes.values()].map((n) => n.deck))];
        case "modelNames":
          return [...new Set([...notes.values()].map((n) => n.model))];
        case "findNotes": {
          const q = String(params["query"]);
          const deck = /"deck:((?:\\.|[^"\\])*)"/.exec(q)?.[1]?.replace(/\\(.)/g, "$1");
          const model = /"note:((?:\\.|[^"\\])*)"/.exec(q)?.[1]?.replace(/\\(.)/g, "$1");
          return [...notes]
            .filter(([, n]) => (!deck || n.deck === deck) && (!model || n.model === model))
            .map(([id]) => id);
        }
        case "notesInfo":
          return (params["notes"] as number[]).map((id) => {
            const n = notes.get(id)!;
            return {
              noteId: id,
              modelName: n.model,
              tags: [],
              fields: Object.fromEntries(
                Object.entries(n.fields).map(([k, v], order) => [k, { value: v, order }]),
              ),
              cards: [id * 10],
            };
          });
        case "cardsInfo":
          return (params["cards"] as number[]).map((cardId) => ({
            cardId,
            note: cardId / 10,
            deckName: notes.get(cardId / 10)!.deck,
            modelName: notes.get(cardId / 10)!.model,
            interval: 30,
            type: 2,
            queue: 2,
            reps: 3,
            lapses: 0,
          }));
        case "getReviewsOfCards":
          return Object.fromEntries((params["cards"] as string[]).map((c) => [c, []]));
        case "addNote": {
          const n = params["note"] as {
            deckName: string;
            modelName: string;
            fields: Record<string, string>;
          };
          const id = next++;
          notes.set(id, { deck: n.deckName, model: n.modelName, fields: n.fields });
          return id;
        }
        default:
          return null;
      }
    })();
    return new Response(JSON.stringify({ result, error: null }));
  }) as typeof globalThis.fetch;
  return { client: new AnkiConnectClient({ fetch }), calls };
}

const NL = new Set(["fiets", "huis", "lopen", "boek"]);
const nlp = {
  detect: async (texts: string[]) =>
    texts.map((t) => ({ lang: NL.has(t) ? "nl" : t ? "en" : null, confidence: 0.9 })),
  analyzeTerms: async (_lang: string, terms: string[]) =>
    terms.map((t) => ({ key: t.toLowerCase(), aliases: [], article: null })),
} as unknown as NlpClient;

let repo: KenningRepository | null = null;
afterEach(async () => {
  await repo?.close();
  repo = null;
});

async function setup(notes: Map<number, Note>) {
  repo = await createRepository(await createNodeDriver(":memory:"));
  const anki = fakeAnki(notes);
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const live = createLiveProfile({
    repo,
    settings: async () => settings,
    anki: async () => anki.client,
    nlp: async () => nlp,
    changed: () => {},
  });
  return { repo, anki, live };
}

const collection = () =>
  new Map<number, Note>([
    [1, { deck: "Dutch", model: "W", fields: { Woord: "fiets", Meaning: "bike" } }],
    [2, { deck: "Dutch", model: "W", fields: { Woord: "huis", Meaning: "house" } }],
    [3, { deck: "Other NL", model: "W", fields: { Woord: "lopen", Meaning: "walk" } }],
    [4, { deck: "Opmaat::1", model: "B", fields: { Front: "boek", Back: "book" } }],
  ]);

describe("live language profile", () => {
  it("a new user has no profile (onboarding), an old user is migrated once", async () => {
    const { repo, live } = await setup(collection());
    expect(await live.services.languageProfile()).toBeNull();
    await repo.append({
      type: "SettingChanged",
      key: "settings",
      value: { targetDeck: "Kenning::Reading" },
    });
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [],
      sources: ["Dutch", "Kenning::Reading"],
    });
    live.invalidate();
    const p = await live.services.languageProfile();
    expect(p).toMatchObject({
      lang: "nl",
      sources: [{ deck: "Dutch" }],
      destinations: { default: "Kenning::Reading" },
      courseDecks: "default",
    });
    // Saved as an event, so it is stable and visible to the MCP server.
    expect(await repo.languageProfile("nl")).toEqual(p);
    expect((await live.services.deckChoices("converse")).deck).toBe("Kenning::Reading");
  });

  it("the snapshot reads only confirmed sources plus course-mapped decks", async () => {
    const { repo, live } = await setup(collection());
    await live.services.saveLanguageProfile(defaultProfile("nl", [{ deck: "Dutch" }], "connected"));
    await repo.append({
      type: "CourseImported",
      course: { id: "c1", title: "Opmaat", lang: "nl", createdAt: 0 } as never,
    });
    await repo.append({
      type: "UnitDefined",
      courseId: "c1",
      units: [{ n: 1, title: "Thema 1", pages: [1, 2], ankiDecks: ["Opmaat::1"] }] as never,
    });
    const snap = await live.snapshot();
    expect(snap.sources.map((s) => s.deck).sort()).toEqual(["Dutch", "Opmaat::1"]);
    expect(snap.entries.map((e) => e.key).sort()).toEqual(["boek", "fiets", "huis"]);
  });

  it("deck choices: profile deck per source, course rule, Kenning, course and Anki decks", async () => {
    const { repo, live } = await setup(collection());
    await live.services.saveLanguageProfile(defaultProfile("nl", [], "connected"));
    await repo.append({
      type: "CourseImported",
      course: { id: "c1", title: "Opmaat", lang: "nl", createdAt: 0 } as never,
    });
    await repo.append({
      type: "UnitDefined",
      courseId: "c1",
      units: [{ n: 1, title: "Thema 1", pages: [1, 2], ankiDecks: ["Opmaat::1"] }] as never,
    });
    const reading = await live.services.deckChoices("reading");
    expect(reading.deck).toBe("Kenning::Nederlands::Reading");
    const groups = (g: string) => reading.options.filter((o) => o.group === g).map((o) => o.deck);
    expect(groups("kenning")).toContain("Kenning::Nederlands::Converse");
    expect(groups("course")).toEqual(["Opmaat::1"]);
    expect(groups("anki")).toContain("Other NL");
    const unit = await live.services.deckChoices("course", { courseId: "c1", unitN: 1 });
    expect(unit.deck).toBe("Kenning::Nederlands::Opmaat::Thema 1");
  });

  it("suggests detected decks with previews; placement is app-only", async () => {
    const { repo, live, anki } = await setup(collection());
    const s = await live.services.suggestDecks();
    // Small decks are only sampled once confirmed; "Dutch" has 2 notes so it needs confirming.
    expect(s).toEqual([]);
    await live.services.saveLanguageProfile(defaultProfile("nl", [{ deck: "Dutch" }], "connected"));
    const again = await live.services.suggestDecks();
    expect(again[0]).toMatchObject({ deck: "Dutch", wordField: "Woord", suggested: true });
    expect(again[0]!.examples.sort()).toEqual(["fiets", "huis"]);

    await live.services.savePlacement(["huis", "huis", "fiets"]);
    expect((await repo.word("nl", "huis"))?.state).toBe("known");
    expect(anki.calls.map((c) => c.action)).not.toContain("addNote");
  });

  it("the shared add command with the live profile: deck, tags and key", async () => {
    const { repo, live, anki } = await setup(new Map());
    await live.services.saveLanguageProfile(defaultProfile("nl", [], "connected"));
    const r = await addWordToAnki(anki.client, (e) => repo.append(e), {
      profile: await live.current(),
      context: { source: "reading" },
      word: "de fiets",
    });
    expect(r).toMatchObject({ deck: "Kenning::Nederlands::Reading", key: "fiets" });
    const add = anki.calls.find((c) => c.action === "addNote")!.params["note"] as {
      tags: string[];
    };
    expect(add.tags).toEqual(["kenning", "nl", "kenning::from::reading"]);
    expect(anki.calls.find((c) => c.action === "createDeck")?.params["deck"]).toBe(
      "Kenning::Nederlands::Reading",
    );
    expect((await repo.word("nl", "fiets"))?.addedNoteId).toBe(r.noteId);
  });
});
