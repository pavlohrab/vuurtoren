import type { WordState } from "@app/core";
import { type KenningRepository, createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveServices } from "./live.js";
import { locateWord } from "./livePractice.js";
import { createPracticeData } from "./practiceData.js";

const WORDS: [string, string, string, WordState][] = [
  ["huis", "house", "het", "known"],
  ["boom", "tree", "de", "known"],
  ["fiets", "bike", "de", "learning"],
  ["tuin", "garden", "de", "learning"],
  ["brug", "bridge", "de", "learning"],
  ["boek", "book", "het", "known"],
];
const SENTENCES: Record<string, [string, string]> = {
  huis: ["Het huis is erg groot.", "The house is very big."],
  fiets: ["Mijn fiets staat in de schuur.", "My bike is in the shed."],
};

interface Backend {
  fetchFn: ReturnType<typeof vi.fn>;
  paths: string[];
}

/** Fake NLP server; `down` answers the practice endpoints with 503. */
function backend(opts: { down?: boolean } = {}): Backend {
  const paths: string[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url), "http://x").pathname.replace(/^\/nlp/, "");
    paths.push(path);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (path === "/gloss") {
      const w = body["words"] as string[];
      return Response.json(
        Object.fromEntries(
          w.map((x) => [x, [{ pos: "noun", glosses: [`${x} (dict)`], article: "de" }]]),
        ),
      );
    }
    if (opts.down) return new Response("unavailable", { status: 503 });
    if (path === "/forms") return Response.json({ fiets: { plural: "fietsen" } });
    if (path === "/sentences") {
      return Response.json({
        brug: [
          {
            text: "Wij lopen over de brug.",
            translation: "We walk across the bridge.",
            target: [18, 22],
            source: "tatoeba",
          },
        ],
      });
    }
    if (path === "/similar") return Response.json({ huis: ["hut", "huur"] });
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchFn);
  return { fetchFn, paths };
}

let repoToClose: KenningRepository | null = null;
afterEach(async () => {
  vi.unstubAllGlobals();
  await repoToClose?.close();
  repoToClose = null;
});

async function setup(entries = WORDS) {
  const repo = await createRepository(await createNodeDriver(":memory:"));
  repoToClose = repo;
  await repo.append({
    type: "AnkiSnapshotImported",
    lang: "nl",
    sources: ["Deck"],
    entries: entries.map(([key, gloss, article, state]) => ({
      key,
      state,
      pKnown: state === "known" ? 0.95 : 0.4,
      noteIds: [1],
      decks: ["Deck"],
      gloss,
      article,
      ...(SENTENCES[key]
        ? { sentence: SENTENCES[key]![0], sentenceTranslation: SENTENCES[key]![1] }
        : {}),
    })),
  });
  return { repo, services: createLiveServices(repo) };
}

describe("locateWord", () => {
  it("finds the exact word, then an inflection with the same stem", () => {
    expect(locateWord("Het huis is groot.", "huis")).toEqual([4, 8]);
    expect(locateWord("Zij fietsen naar huis.", "fiets")).toEqual([4, 11]);
    expect(locateWord("Niets te zien.", "boom")).toBeNull();
  });
});

describe("live practice", () => {
  it("builds a session from the learner model, Anki sentences and server data", async () => {
    const be = backend();
    const { services } = await setup();
    const o = await services.practiceOverview();
    expect(o).toMatchObject({ due: 0, learned: 0, newAvailable: 3, lastSession: null });

    const session = await services.startPractice({ size: 20 });
    expect(session.length).toBeGreaterThan(3);
    const keys = new Set(WORDS.map((w) => w[0]));
    expect(session.every((e) => keys.has(e.key))).toBe(true);
    // Anki sentences become cloze exercises with their translation
    const cloze = session.find((e) => e.key === "huis" && e.kind.startsWith("cloze"));
    if (cloze) expect(cloze.prompt.translation).toBe("The house is very big.");
    expect(session.some((e) => e.kind === "gender")).toBe(true);
    // forms, sentences and similar words came from the server, batched
    expect(be.paths.filter((p) => p === "/forms")).toHaveLength(1);
    expect(be.paths.filter((p) => p === "/sentences")).toHaveLength(1);
    // a second session reuses the cache instead of asking again
    await services.startPractice({ size: 20 });
    expect(be.paths.filter((p) => p === "/forms")).toHaveLength(1);
    expect(be.paths.filter((p) => p === "/sentences")).toHaveLength(1);
  });

  it("restricts to the chosen skills", async () => {
    backend();
    const { services } = await setup();
    const session = await services.startPractice({ size: 10, skills: ["gender"] });
    expect(session.length).toBeGreaterThan(0);
    expect(session.every((e) => e.skill === "gender")).toBe(true);
  });

  it("works without the server's practice endpoints", async () => {
    backend({ down: true });
    const { services } = await setup();
    const session = await services.startPractice({ size: 10 });
    expect(session.length).toBeGreaterThan(0);
  });

  it("is empty when no word is being learned or known", async () => {
    backend();
    const { services } = await setup([["huis", "house", "het", "unknown"]]);
    expect(await services.startPractice()).toEqual([]);
  });

  it("grades answers, schedules the pair and records the event", async () => {
    backend();
    const { repo, services } = await setup();
    const [first] = await services.startPractice({ size: 5, skills: ["gender"] });
    expect(first).toBeDefined();
    const right = await services.answerExercise(first!, {
      exerciseId: first!.id,
      answer: first!.answer,
      hintsUsed: 0,
      ms: 1500,
    });
    expect(right.correct).toBe(true);
    expect(right.grade).not.toBe("again");
    expect(right.next).toMatchObject({ key: first!.key, skill: "gender", reps: 1 });

    const wrong = await services.answerExercise(first!, {
      exerciseId: first!.id,
      answer: first!.answer === "de" ? "het" : "de",
      hintsUsed: 0,
      ms: 900,
    });
    expect(wrong).toMatchObject({ correct: false, grade: "again" });

    const items = await repo.practiceItems("nl");
    expect(items).toHaveLength(1);
    expect(items[0]!.reps).toBe(2);
    const log = await repo.practiceLog("nl", 10);
    expect(log.map((l) => l.correct)).toEqual([false, true]);
    const o = await services.practiceOverview();
    expect(o.lastSession).not.toBeNull();
    expect(o.newAvailable).toBeLessThanOrEqual(3);
  });
});

describe("practice data wrapper", () => {
  it("degrades to empty data on errors and caches misses", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 404 }));
    const data = createPracticeData(
      () => "/nlp",
      () => fetchFn as unknown as typeof fetch,
    );
    expect(await data.forms("nl", [{ lemma: "lopen", pos: "VERB" }])).toEqual({});
    expect(await data.forms("nl", [{ lemma: "lopen", pos: "VERB" }])).toEqual({});
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const failing = createPracticeData(
      () => "/nlp",
      () =>
        (async () => {
          throw new TypeError("offline");
        }) as unknown as typeof fetch,
    );
    expect(await failing.similar("nl", [{ lemma: "huis", pos: "NOUN" }], 3)).toEqual({});
  });
});
