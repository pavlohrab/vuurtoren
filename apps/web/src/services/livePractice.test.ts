import type { WordState } from "@app/core";
import { type VuurtorenRepository, createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveServices } from "./live.js";
import { locateWord } from "./livePractice.js";

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
function backend(
  opts: {
    down?: boolean;
    glosses?: Record<string, string>;
    similar?: Record<string, string[]>;
  } = {},
): Backend {
  const paths: string[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url), "http://x").pathname.replace(/^\/nlp/, "");
    paths.push(path);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (path === "/gloss") {
      const w = body["words"] as string[];
      return Response.json(
        Object.fromEntries(
          w.map((x) => [
            x,
            [{ pos: "noun", glosses: [opts.glosses?.[x] ?? `${x} (dict)`], article: "de" }],
          ]),
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
    if (path === "/similar") return Response.json(opts.similar ?? { huis: ["hut", "huur"] });
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchFn);
  return { fetchFn, paths };
}

let repoToClose: VuurtorenRepository | null = null;
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
  it("finds the exact word and known forms only", () => {
    expect(locateWord("Het huis is groot.", "huis")).toEqual([4, 8]);
    expect(locateWord("Zij fietsen naar huis.", "fiets", { pos: "NOUN" })).toEqual([4, 11]);
    expect(locateWord("Niets te zien.", "boom")).toBeNull();
  });

  it("does not blank a different word that shares a prefix", () => {
    expect(locateWord("Zij is blij dat het kan.", "zijn", { pos: "VERB" })).toBeNull();
    expect(locateWord("Op een manier die kan.", "man", { pos: "NOUN" })).toBeNull();
    expect(locateWord("Dat werk is zwaar.", "werken", { pos: "VERB" })).toBeNull();
  });

  it("matches irregular and regular forms of the word", () => {
    const forms = { past: ["liep", "liepen"] as [string, string], participle: "gelopen" };
    expect(locateWord("Hij liep naar huis.", "lopen", { pos: "VERB", forms })).toEqual([4, 8]);
    expect(locateWord("Zij is gelopen.", "lopen", { pos: "VERB", forms })).toEqual([7, 14]);
    expect(locateWord("Hij werkt hard.", "werken", { pos: "VERB" })).toEqual([4, 9]);
    expect(locateWord("Hij liep naar huis.", "lopen", { pos: "VERB" })).toBeNull();
  });
});

describe("live practice", () => {
  it("offers lessons from the last text, the week's mistakes and a weak grammar point", async () => {
    backend();
    const { repo, services } = await setup();
    const text = { id: "t-brug" };
    await repo.append({
      type: "TextImported",
      textId: text.id,
      title: "De brug",
      lang: "nl",
      source: { kind: "paste" },
      content: "De brug is dicht.",
    });
    await repo.append({ type: "WordLookedUp", lang: "nl", key: "huis", textId: text.id });
    const now = Date.now();
    for (const [key, at] of [
      ["huis", now - 2000],
      ["fiets", now - 1000],
    ] as const)
      await repo.append({
        type: "ExerciseAnswered",
        lang: "nl",
        key,
        skill: "gender",
        kind: "gender",
        grade: "again",
        correct: false,
        ms: 900,
        at,
        state: { key, skill: "gender" } as never,
      });
    const sources = await services.lessonSources!(text.id);
    expect(sources.page).toMatchObject({ textId: text.id, title: "De brug", keys: ["huis"] });
    expect(sources.mistakes.sort()).toEqual(["fiets", "huis"]);
    expect(sources.weak).toEqual({ topic: "de-het", misses: 2 });
    expect((await services.lessonSources!(null)).page).toBeNull();
  });

  it("gives a missed word a second go of another kind (algorithms.md 4.7.6)", async () => {
    backend();
    const { services } = await setup();
    const lesson = await services.startPractice();
    expect(lesson.length).toBeGreaterThan(0);
    const missed = lesson[0]!;
    const again = await services.comeBack!(missed);
    if (again) {
      expect(again.key).toBe(missed.key);
      expect(again.kind).not.toBe(missed.kind);
      expect(again.id.endsWith("-again")).toBe(true);
    }
  });

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

describe("live practice: regressions", () => {
  const small: [string, string, string, WordState][] = [
    ["huis", "house", "het", "learning"],
    ["boom", "tree", "de", "learning"],
    ["tuin", "garden", "de", "learning"],
  ];

  it("never pads word-choice with synonyms or words of unknown meaning", async () => {
    backend({
      glosses: { woning: "dwelling, house", hut: "shack", onbekend: "" },
      similar: { huis: ["woning", "hut", "onbekend", "nergens"] },
    });
    const { services } = await setup(small);
    let seen = 0;
    for (let n = 0; n < 40 && seen < 3; n++) {
      const session = await services.startPractice({ size: 20, skills: ["recognition"] });
      for (const e of session.filter((x) => x.kind === "word-choice" && x.key === "huis")) {
        seen++;
        expect(e.choices).not.toContain("woning");
        expect(e.choices).not.toContain("nergens"); // no dictionary entry: unvetted
        expect(e.choices).not.toContain("onbekend");
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("counts only practisable words in the overview", async () => {
    backend();
    const { repo, services } = await setup();
    const [first] = await services.startPractice({ size: 5, skills: ["gender"] });
    await services.answerExercise(first!, {
      exerciseId: first!.id,
      answer: "x",
      hintsUsed: 0,
      ms: 100,
    });
    expect((await services.practiceOverview()).bySkill.gender).toBe(1);
    await repo.append({ type: "WordStateSet", lang: "nl", key: first!.key, state: "ignored" });
    const o = await services.practiceOverview();
    expect(o.bySkill.gender).toBe(0);
    expect(o.due).toBe(0);
  });

  it("reads practice items once per session, not once per answer", async () => {
    backend();
    const { repo, services } = await setup();
    const spy = vi.spyOn(repo, "practiceItems");
    const session = await services.startPractice({ size: 6, skills: ["gender"] });
    const reads = spy.mock.calls.length;
    for (const e of session.slice(0, 3)) {
      await services.answerExercise(e, { exerciseId: e.id, answer: e.answer, hintsUsed: 0, ms: 1 });
    }
    expect(spy.mock.calls.length).toBe(reads);
    // the cache is updated: answering the same pair again continues its schedule
    const e = session[0]!;
    const again = await services.answerExercise(e, {
      exerciseId: e.id,
      answer: e.answer,
      hintsUsed: 0,
      ms: 1,
    });
    expect(again.next.reps).toBe(2);
  });

  it("reports a degraded language server in the overview", async () => {
    backend({ down: true });
    const { services } = await setup();
    await services.startPractice({ size: 5 });
    expect((await services.practiceOverview()).degraded).toBe(true);
  });
});
