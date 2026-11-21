/** Native services over a real repository: the move from Anki, a deck file, reviews, tuning. */
import { DatabaseSync } from "node:sqlite";
import { zipSync } from "fflate";
import { AnkiConnectClient, type CreateSqlite, type OpenSqlite, readAnkiPackage } from "@app/anki";
import { DEFAULT_FSRS_PARAMS, type LanguageProfile, defaultProfile } from "@app/core";
import { type VuurtorenRepository, createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import type { NlpClient } from "@app/nlp-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunOptimizer } from "../native/optimizer.js";
import { createLiveNative, readingDelay } from "./liveNative.js";
import { createLiveServices } from "./live.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 1, 12);

const sqlite = () => ({
  open: (async (bytes) => {
    const db = new DatabaseSync(":memory:");
    db.deserialize(bytes);
    return {
      all: async (sql: string) => db.prepare(sql).all() as Record<string, unknown>[],
      close: async () => db.close(),
    };
  }) satisfies OpenSqlite,
  create: (async () => {
    const db = new DatabaseSync(":memory:");
    return {
      exec: async (sql: string, params: readonly (string | number | null)[] = []) => {
        db.prepare(sql).run(...params);
      },
      bytes: async () => new Uint8Array(db.serialize()),
      close: async () => db.close(),
    };
  }) satisfies CreateSqlite,
  dispose: () => undefined,
});

/** An Anki with one deck of two notes; the first was learned 60 days ago and reviewed since. */
function fakeAnki() {
  const writes: string[] = [];
  const READS = new Set([
    "deckNames",
    "getDeckConfig",
    "findNotes",
    "notesInfo",
    "findModelsByName",
    "cardsInfo",
    "getReviewsOfCards",
    "retrieveMediaFile",
  ]);
  const learned = NOW - 60 * DAY;
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/api/v1")) return new Response("{}", { status: 404 });
    const { action } = JSON.parse(String(init?.body)) as { action: string };
    if (!READS.has(action)) writes.push(action);
    const result = (() => {
      switch (action) {
        case "deckNames":
          return ["Dutch", "Other"];
        case "getDeckConfig":
          return {
            new: { delays: [1, 10], perDay: 15 },
            lapse: { delays: [10] },
            rev: { maxIvl: 3650 },
          };
        case "findNotes":
          return [1, 2];
        case "notesInfo":
          return [1, 2].map((noteId) => ({
            noteId,
            modelName: "Dutch word",
            tags: [],
            fields: {
              Woord: { value: noteId === 1 ? "het huis" : "de fiets", order: 0 },
              Betekenis: { value: noteId === 1 ? "house" : "bicycle", order: 1 },
            },
            cards: [noteId * 10],
          }));
        case "findModelsByName":
          return [
            {
              id: 77,
              name: "Dutch word",
              type: 0,
              css: "",
              flds: [
                { name: "Woord", ord: 0 },
                { name: "Betekenis", ord: 1 },
              ],
              tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Woord}}", afmt: "{{Betekenis}}" }],
            },
          ];
        case "cardsInfo":
          return [
            {
              cardId: 10,
              note: 1,
              deckName: "Dutch",
              modelName: "Dutch word",
              interval: 40,
              type: 2,
              queue: 2,
              reps: 4,
              lapses: 0,
              ord: 0,
              due: 900,
            },
            {
              cardId: 20,
              note: 2,
              deckName: "Dutch",
              modelName: "Dutch word",
              interval: 0,
              type: 0,
              queue: 0,
              reps: 0,
              lapses: 0,
              ord: 0,
              due: 3,
            },
          ];
        case "getReviewsOfCards":
          return {
            10: [
              { id: learned, ease: 3, type: 0, time: 3000 },
              { id: learned + 600_000, ease: 3, type: 0, time: 3000 },
              { id: learned + 3 * DAY, ease: 3, type: 1, time: 3000 },
              { id: learned + 15 * DAY, ease: 3, type: 1, time: 3000 },
              { id: learned + 50 * DAY, ease: 4, type: 1, time: 3000 },
            ],
            20: [],
          };
        case "multi":
          // Like AnkiConnect: each action sent with version 6 answers `{ result, error }`.
          return (
            JSON.parse(String(init?.body)) as { params: { actions: unknown[] } }
          ).params.actions.map(() => ({ result: true, error: null }));
        default:
          return null;
      }
    })();
    return new Response(JSON.stringify({ result, error: null }));
  }) as typeof globalThis.fetch;
  return { client: new AnkiConnectClient({ url: "http://anki", fetch }), writes };
}

const nlp = {
  detect: async (texts: string[]) =>
    texts.map((t) => ({ lang: /^(house|bicycle|cat)$/.test(t) ? "en" : "nl", confidence: 0.9 })),
  analyzeTerms: async (_lang: string, terms: string[]) =>
    terms.map((t) => ({ key: t.split(" ").at(-1)!, aliases: [], article: t.split(" ")[0]! })),
} as unknown as NlpClient;

let repo: VuurtorenRepository | undefined;
afterEach(async () => {
  await repo?.close();
  repo = undefined;
});

async function setup(
  profile: LanguageProfile,
  optimizer?: RunOptimizer,
  reviewWeek: readonly number[] = [],
  audioClip?: (id: string) => Promise<Blob | null>,
) {
  let t = NOW;
  const r = await createRepository(await createNodeDriver(), { deviceId: "d", now: () => t });
  repo = r;
  await r.append({ type: "LanguageProfileSet", profile });
  const anki = fakeAnki();
  let current = profile;
  const live = createLiveNative({
    repo: r,
    lang: async () => "nl",
    profile: async () => current,
    saveProfile: async (p) => {
      current = p;
      await r.append({ type: "LanguageProfileSet", profile: p });
    },
    anki: async () => anki.client,
    nlp: async () => nlp,
    changed: () => undefined,
    optimizer: optimizer ?? (async () => Promise.reject(new Error("no optimizer"))),
    sqlite,
    reviewWeek: async () => reviewWeek,
    ...(audioClip ? { audioClip } : {}),
    now: () => t,
  });
  return {
    live: live.services,
    evidence: live.evidence,
    anki,
    profile: () => current,
    tick: (ms: number) => (t += ms),
    at: () => t,
  };
}

describe("native services", () => {
  it("lists due words, shows a word's reviews and undoes stored answers one by one", async () => {
    const { live, tick } = await setup(defaultProfile("nl", [{ deck: "Dutch" }], "connected"));
    await live.moveFromAnki();
    expect(await live.lastReview()).toBeNull();
    // fiets (card 20) answered Again at NOW: learning, due a minute later (long past now).
    const first = await live.answerReview(20, 1, 1500);
    tick(30_000);
    const second = await live.answerReview(20, 3, 1500);
    expect(await live.lastReview()).toMatchObject({ cardId: 20, reviewId: second.reviewId });

    // The rest of the app over the same database (no language server: the form itself).
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const app = createLiveServices(repo!);
    const due = await app.dueWords();
    expect(due.map((w) => w.key)).toContain("fiets");
    expect(due.find((w) => w.key === "fiets")?.due).toBeLessThan(Date.now());
    const entry = await app.inspectWord("fiets");
    expect(entry.anki.reviews?.map((r) => r.rating)).toEqual([3, 1]);
    expect(entry.anki.reviews?.[1]?.interval).toBe("1m");
    vi.unstubAllGlobals();

    await live.undoReview(20, (await live.lastReview())!.reviewId);
    expect(await live.lastReview()).toMatchObject({ reviewId: first.reviewId });
    await live.undoReview(20, first.reviewId);
    expect(await live.lastReview()).toBeNull();
  });

  it("moves from Anki: notes, cards and history come in, Anki is not written", async () => {
    const connected = defaultProfile("nl", [{ deck: "Dutch" }], "connected");
    const { live, anki, profile } = await setup(connected);
    expect((await live.reviewOverview()).native).toBe(false);
    const summary = await live.moveFromAnki();
    expect(summary).toMatchObject({ notes: 2, cards: 2, reviews: 5, vocabNotes: 2 });
    expect(anki.writes).toEqual([]);
    expect(profile().mode).toBe("native");
    expect((await repo!.languageProfile("nl"))?.mode).toBe("native");
    // The replayed history makes "huis" known; "fiets" is a new card.
    const model = await repo!.learnerModel("nl");
    expect(model.get("huis")?.state).toBe("known");
    expect(model.get("fiets")?.state).toBe("unknown");
    // The card keeps its Anki ids.
    expect((await repo!.nativeCard("nl", 10))?.note.id).toBe(1);
    const decks = await live.nativeDecks();
    expect(decks[0]).toMatchObject({ name: "Dutch", total: 2, fresh: 1 });
    expect(decks[0]?.options.newPerDay).toBe(15);
  });

  it("imports a deck file, reviews with intervals, and undoes an answer", async () => {
    const { live, tick } = await setup(defaultProfile("nl"));
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE col (crt INTEGER, models TEXT, decks TEXT, dconf TEXT)");
    db.exec("CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT, tags TEXT)");
    db.exec(
      "CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, ord INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, odue INTEGER, odid INTEGER)",
    );
    db.exec(
      "CREATE TABLE revlog (id INTEGER, cid INTEGER, ease INTEGER, type INTEGER, time INTEGER)",
    );
    const models = {
      5: {
        id: 5,
        name: "Basic",
        type: 0,
        css: "",
        flds: [
          { name: "Front", ord: 0 },
          { name: "Back", ord: 1 },
        ],
        tmpls: [
          {
            name: "Card 1",
            ord: 0,
            qfmt: "{{Front}}",
            afmt: '{{FrontSide}}<hr>{{Back}}<img src="k.png">',
          },
        ],
      },
    };
    db.prepare("INSERT INTO col VALUES (?,?,?,?)").run(
      NOW / 1000 - 100 * 86400,
      JSON.stringify(models),
      JSON.stringify({ 1: { id: 1, name: "Words", conf: 1, dyn: 0 } }),
      JSON.stringify({ 1: { new: { delays: [1, 10], perDay: 20 } } }),
    );
    db.prepare("INSERT INTO notes VALUES (1, 5, ?, '')").run("de kat\x1fcat");
    db.prepare("INSERT INTO cards VALUES (11, 1, 1, 0, 0, 0, 1, 0, 0, 0)").run();
    const apkg = zipSync({
      "collection.anki2": db.serialize(),
      media: new TextEncoder().encode('{"0":"k.png"}'),
      0: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const { token, decks } = await live.openPackage(new File([apkg], "words.apkg"));
    expect(decks).toEqual([{ name: "Words", notes: 1, cards: 1, reviews: 0 }]);
    expect(await live.importPackage(token, ["Words"])).toMatchObject({ cards: 1, media: 1 });

    const q = await live.reviewQueue();
    expect(q).toMatchObject({ due: 0, fresh: 1 });
    const card = q.cards[0]!;
    expect(card).toMatchObject({ layout: "vocab", word: "de kat", gloss: "cat", isNew: true });
    expect(card.intervals).toEqual({ 1: "1m", 2: "6m", 3: "10m", 4: expect.stringMatching(/d$/) });
    const blob = await live.mediaFile(card.media["k.png"]!);
    expect(blob?.type).toBe("image/png");

    const { reviewId } = await live.answerReview(card.cardId, 3, 4000);
    tick(1000);
    // The card is in its 10-minute learning step: with nothing else left it comes forward.
    const after = await live.reviewQueue();
    expect(after).toMatchObject({ due: 0, fresh: 0 });
    expect(after.cards[0]).toMatchObject({ cardId: 11, isNew: false });
    expect(after.cards[0]?.intervals[1]).toBe("1m");
    await live.undoReview(card.cardId, reviewId);
    const undone = await live.reviewQueue();
    expect(undone).toMatchObject({ fresh: 1 });
    expect(undone.cards[0]).toMatchObject({ cardId: 11, isNew: true });
  });

  it("moves back to Anki: notes Anki has stay, reviewed cards get their due date, the profile is connected", async () => {
    const { live, anki, profile } = await setup(
      defaultProfile("nl", [{ deck: "Dutch" }], "connected"),
    );
    await live.moveFromAnki();
    expect(profile().mode).toBe("native");
    const r = await live.moveToAnki(false);
    expect(r).toEqual({ added: 0, existing: 2, skipped: 0, scheduled: 1, reviews: 0 });
    expect(anki.writes).toEqual(["multi"]);
    expect(profile().mode).toBe("connected");
    expect(profile().sources.map((s) => s.deck)).toEqual(["Dutch"]);
    await expect(live.moveToAnki(false)).rejects.toThrow(/already in Anki/);
  });

  it("spreads a review's due date away from lighter days", async () => {
    // Only Sunday takes reviews.
    const { live } = await setup(
      defaultProfile("nl", [{ deck: "Dutch" }], "connected"),
      undefined,
      [0, 0, 0, 0, 0, 0, 1],
    );
    await live.moveFromAnki();
    await live.answerReview(10, 3, 2000);
    const s = (await repo!.nativeCard("nl", 10))!.card.schedule!;
    expect(s.scheduledDays).toBeGreaterThan(7);
    expect(new Date(s.due).getDay()).toBe(0);
  });

  it("lets Practice and blanks answer the word's due card, once a day", async () => {
    const { live, evidence, tick, at } = await setup(
      defaultProfile("nl", [{ deck: "Dutch" }], "connected"),
    );
    await live.moveFromAnki();
    const before = (await repo!.nativeCard("nl", 10))!.card.schedule!;
    // Not due yet: a right answer changes nothing.
    expect(await evidence.exercise("huis", "good", 3000)).toBe(false);
    tick(before.due - at() + 60_000);
    expect(await evidence.exercise("huis", "good", 3000)).toBe(true);
    const after = (await repo!.nativeCard("nl", 10))!.card.schedule!;
    expect(after.lastReview).toBe(at());
    expect(after.due).toBeGreaterThan(before.due);
    // One answer per word a day; the blank of the same word is not counted again.
    expect(await evidence.cloze("huis", true, false)).toBe(false);
    expect((await repo!.nativeReviews("nl")).at(-1)).toMatchObject({ cardId: 10, rating: 3 });
    // A new card is never introduced by practice.
    expect(await evidence.exercise("fiets", "again", 1000)).toBe(false);
  });

  it("counts a wrong answer on a card that is not due", async () => {
    const { live, evidence } = await setup(defaultProfile("nl", [{ deck: "Dutch" }], "connected"));
    await live.moveFromAnki();
    expect(await evidence.cloze("huis", false, false)).toBe(true);
    expect((await repo!.nativeCard("nl", 10))!.card.schedule!.state).toBe(3);
  });

  it("moves a due card later when its word is read, and brings it back on a lookup", async () => {
    const { live, evidence, tick, at } = await setup(
      defaultProfile("nl", [{ deck: "Dutch" }], "connected"),
    );
    await live.moveFromAnki();
    const s = (await repo!.nativeCard("nl", 10))!.card.schedule!;
    // A lookup of a word not due: due now.
    expect(await evidence.lookup("huis")).toBe(1);
    expect((await repo!.nativeCard("nl", 10))!.card.schedule!.due).toBe(at());
    // Read without a lookup: later by 15 % of the interval (1–7 days); not an answer.
    tick(1000);
    expect(await evidence.pageRead(["huis", "fiets"])).toBe(1);
    const moved = (await repo!.nativeCard("nl", 10))!.card.schedule!;
    expect(moved.due).toBe(at() + readingDelay(s.scheduledDays) * DAY);
    expect(moved.lastReview).toBe(s.lastReview);
    expect(await repo!.nativeReviews("nl")).toHaveLength(5);
    expect(readingDelay(2)).toBe(1);
    expect(readingDelay(20)).toBe(3);
    expect(readingDelay(400)).toBe(7);
  });

  it("leaves connected learners' cards alone", async () => {
    const { evidence } = await setup(defaultProfile("nl", [{ deck: "Dutch" }], "connected"));
    expect(await evidence.exercise("huis", "again", 1000)).toBe(false);
    expect(await evidence.pageRead(["huis"])).toBe(0);
  });

  it("exports moved cards with their history to an .apkg that reads back", async () => {
    const { live } = await setup(defaultProfile("nl", [{ deck: "Dutch" }], "connected"));
    await live.moveFromAnki();
    const q = await live.reviewQueue();
    await live.answerReview(q.cards[0]!.cardId, 3, 2500);
    const { bytes, fileName, summary } = await live.exportPackage([]);
    expect(fileName).toMatch(/^Vuurtoren-\d{4}-\d\d-\d\d\.apkg$/);
    expect(summary).toMatchObject({ notes: 2, cards: 2, reviews: 6 });
    const col = await readAnkiPackage(bytes, sqlite().open);
    expect(col.decks.map((d) => d.name)).toContain("Dutch");
    expect(col.cards.map((c) => c.id).sort()).toEqual([10, 20]);
    expect(col.reviews).toHaveLength(6);
    // Only one deck: its name in the file.
    expect((await live.exportPackage(["Dutch"])).fileName).toMatch(/^Dutch-/);
  });

  it("tunes by itself once the history is long enough, and recomputes memory", async () => {
    const optimizer = vi.fn<RunOptimizer>(async (seqs) => ({
      params: DEFAULT_FSRS_PARAMS.map((w, i) => (i === 0 ? w * 2 : w)),
      reviews: seqs.reduce((n, s) => n + s.ratings.length - 1, 0),
      logLoss: 0.3,
      rmse: 0.02,
      previousLogLoss: 0.35,
      previousRmse: 0.04,
      improved: true,
    }));
    const { live } = await setup(defaultProfile("nl"), optimizer);
    expect(await live.autoTune()).toBeNull();
    // 100 cards with 5 answers each.
    const notes = Array.from({ length: 100 }, (_, i) => ({
      id: 1000 + i,
      notetypeId: "t",
      fields: ["x"],
      tags: [],
    }));
    const start = NOW - 200 * DAY;
    await repo!.append({
      type: "NativeNotesAdded",
      lang: "nl",
      origin: "apkg",
      notetypes: [{ id: "t", name: "T", kind: "standard", fields: ["F"], templates: [], css: "" }],
      notes,
      cards: notes.map((n, i) => ({
        id: n.id,
        noteId: n.id,
        ord: 0,
        deck: "D",
        position: i,
        schedule: {
          due: NOW + DAY,
          stability: 10,
          difficulty: 5,
          scheduledDays: 10,
          learningSteps: 0,
          reps: 5,
          lapses: 0,
          state: 2,
          lastReview: NOW - 9 * DAY,
        },
      })),
      reviews: notes.flatMap((n) =>
        [0, 1, 4, 12, 40].map((d, k) => ({
          cardId: n.id,
          at: start + d * DAY,
          rating: 3 as const,
          kind: k === 0 ? ("learn" as const) : ("review" as const),
          durationMs: 1000,
        })),
      ),
    });
    const r = await live.autoTune();
    expect(r).toMatchObject({ tuned: true, improved: true, reviewsUsed: 400, history: 500 });
    expect(optimizer).toHaveBeenCalledTimes(1);
    const card = await repo!.nativeCard("nl", 1000);
    expect(card?.card.schedule?.due).toBe(NOW + DAY);
    expect(card?.card.schedule?.stability).not.toBe(10);
    // Not again until 30 days or 500 more answers.
    expect(await live.autoTune()).toBeNull();
    // Memory travels as stability and difficulty for the parameters used, not a schedule.
    const memory = (await repo!.exportEvents()).find(
      (e) => e.event.type === "NativeCardsChanged",
    )?.event;
    expect(memory).toMatchObject({ reason: "memory", params: expect.any(Array) });
    expect(memory?.type === "NativeCardsChanged" && memory.changes[0]).toEqual({
      cardId: 1000,
      memory: {
        stability: card?.card.schedule?.stability,
        difficulty: card?.card.schedule?.difficulty,
        lastReview: NOW - 9 * DAY,
      },
    });
    expect((await live.tuning()).logLoss).toBe(0.3);
    // Another device tuned a moment ago with less history (synced): not here as well.
    await repo!.append({
      type: "FsrsParamsSet",
      lang: "nl",
      params: [...DEFAULT_FSRS_PARAMS],
      reviews: 100,
      historySize: 0,
    });
    expect(await live.autoTune()).toBeNull();
  });
});

describe("audio on cards of an imported deck", () => {
  it("says the note's word with the answer, unless the card has its own sound", async () => {
    const { live } = await setup({ ...defaultProfile("nl"), mode: "native" });
    const tmpl = { name: "Card 1", front: "{{Front}}", back: "{{Back}}" };
    await repo!.append({
      type: "NativeNotesAdded",
      lang: "nl",
      origin: "apkg",
      notetypes: [
        {
          id: "t",
          name: "Basic",
          kind: "standard",
          fields: ["Front", "Back"],
          templates: [tmpl],
          css: "",
        },
      ],
      notes: [
        {
          id: 1,
          notetypeId: "t",
          fields: ["house", "huis"],
          tags: [],
          key: "huis",
          article: "het",
        },
        { id: 2, notetypeId: "t", fields: ["bike [sound:f.mp3]", "fiets"], tags: [], key: "fiets" },
      ],
      cards: [
        { id: 1, noteId: 1, ord: 0, deck: "D", position: 0 },
        { id: 2, noteId: 2, ord: 0, deck: "D", position: 1 },
      ],
      reviews: [],
    });
    const { cards } = await live.reviewQueue();
    const house = cards.find((c) => c.cardId === 1)!;
    expect(house.layout).toBe("template");
    expect(house.spoken).toBe("het huis");
    expect(house.wordAudio).toMatch(/^word-[0-9a-f]{16}$/);
    expect(cards.find((c) => c.cardId === 2)!.spoken).toBeUndefined();
  });
});

describe("starter words", () => {
  const native = () => ({ ...defaultProfile("nl"), mode: "native" as const });

  const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("adds every level once, in order of rank, one level open at a time", async () => {
    const { live } = await setup(native());
    const first = await live.addStarterLevels({ levels: ALL });
    expect(first).toEqual({ added: 4930, skipped: 0 });
    expect(await live.starterLevels()).toEqual({ held: ALL, all: 10, from: 1 });
    const decks = await live.nativeDecks();
    expect(decks.map((d) => [d.name, d.fresh, d.options.newPerDay]).slice(0, 3)).toEqual([
      ["Vuurtoren · Woorden 1–500", 500, 20],
      ["Vuurtoren · Woorden 501–1000", 500, 0],
      ["Vuurtoren · Woorden 1001–1500", 500, 0],
    ]);
    expect(decks.at(-1)!.fresh).toBe(430);
    const queue = await live.reviewQueue();
    expect(queue.fresh).toBe(20);
    expect(queue.cards.slice(0, 3).map((c) => c.word)).toEqual(["de", "zijn", "van"]);
    // Nothing is marked known.
    expect(queue.due).toBe(0);

    // Twice: nothing new.
    expect(await live.addStarterLevels({ levels: ALL })).toEqual({ added: 0, skipped: 4930 });
    expect((await repo!.nativeStats("nl")).cards).toBe(4930);
  });

  it("starts new words from the chosen level; the levels below wait until turned on", async () => {
    const { live } = await setup(native());
    await live.addStarterLevels({ levels: ALL, from: 3 });
    expect((await live.starterLevels()).from).toBe(3);
    const open = async () =>
      (await live.nativeDecks())
        .filter((d) => d.fresh > 0 && d.options.newPerDay > 0)
        .map((d) => d.name);
    expect(await open()).toEqual(["Vuurtoren · Woorden 1001–1500"]);
    // No card is known or scheduled: the reader's evidence marks words known.
    expect((await live.reviewQueue()).due).toBe(0);
    await live.setStarterFrom(1);
    expect(await open()).toEqual(["Vuurtoren · Woorden 1–500"]);
    expect((await live.starterLevels()).from).toBe(1);
  });

  it("exports the audio pack's clips as Anki sounds when they exist", async () => {
    // A fake pack with the clip of "de" (rank 1) only.
    const pack = vi.fn(async (id: string) =>
      id === "word-600ccd1b71569232" ? new Blob([new Uint8Array([9, 9])]) : null,
    );
    const { live } = await setup(native(), undefined, [], pack);
    await live.addStarterLevels({ levels: [1] });
    const queue = await live.reviewQueue();
    expect(queue.cards[0]).toMatchObject({
      word: "de",
      spoken: "de",
      wordAudio: "word-600ccd1b71569232",
    });
    const { bytes, summary } = await live.exportPackage(["Vuurtoren · Woorden 1–500"]);
    expect(summary.media).toBe(1);
    const col = await readAnkiPackage(bytes, sqlite().open);
    const de = col.notes.find((n) => n.fields[0]?.startsWith("de["))!;
    expect(de.fields[0]).toBe("de[sound:word-600ccd1b71569232.mp3]");
    expect(col.notes.filter((n) => n.fields.join("").includes("[sound:"))).toHaveLength(1);
  });
});
