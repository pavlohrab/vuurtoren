import { type KenningRepository, createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveServices } from "./live.js";

/** A two-page invented book: one theme with an exercise and a text, then the word list. */
const PROSE =
  "Anne woont in Nijmegen en werkt bij een groot bedrijf in de stad. Ze fietst elke dag naar haar werk, ook als het regent. " +
  "In het weekend gaat ze graag naar de markt om groente en fruit te kopen. Daarna drinkt ze koffie met haar vrienden in het café.";
const PAGES = [
  "Inhoud\n1 Kennismaken ........ 2\nWoordenlijst ........ 3",
  `Oefening 1 Vul in.\nAnne _____ (wonen) in Nijmegen.\n\n${PROSE}\nThema 1 Kennismaken 2`,
  "Thema 1\nde naam\nde straat\nwonen\nde fiets",
];

/** Anki notes: 7 naam (new), 8 straat (new, suspended), 9 wonen (review). Card id = note id × 10. */
const NOTES: Record<number, { type: number; queue: number }> = {
  7: { type: 0, queue: 0 },
  8: { type: 0, queue: -1 },
  9: { type: 2, queue: 2 },
};

/** Fake NLP server (OCR job, analysis) and AnkiConnect behind one fetch; records Anki writes. */
function fakeBackend() {
  const anki: { action: string; params: Record<string, unknown> }[] = [];
  const uploads: string[] = [];
  let polls = 0;
  /** Polls to fail with a network error (the client retries a failed request once). */
  const state = { failPoll: 0 };
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/nlp/course/ocr")) {
      if (init?.method === "POST") {
        const form = init.body as FormData;
        uploads.push(...form.getAll("file").map((f) => (f as File).name));
        return Response.json({ id: "j1", total: PAGES.length });
      }
      if (state.failPoll > 0) {
        state.failPoll--;
        throw new TypeError("Failed to fetch");
      }
      // First poll: one page done; second poll: the rest.
      const after = Number(new URL(u, "http://x").searchParams.get("after"));
      const done = polls++ === 0 ? 1 : PAGES.length;
      return Response.json({
        id: "j1",
        status: done === PAGES.length ? "done" : "running",
        error: null,
        done,
        total: PAGES.length,
        pages: PAGES.slice(after, done).map((text, i) => ({
          n: after + i + 1,
          text,
          confidence: 0.9,
          blocks: [],
        })),
      });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (u.includes("/nlp/analyze/text")) {
      return Response.json((body["texts"] as string[]).map(() => ({ tokens: [] })));
    }
    if (u.includes("/nlp/")) return Response.json({});
    if (u.endsWith("/api/v1")) {
      anki.push({
        action: String(body["method"]),
        params: body["params"] as Record<string, unknown>,
      });
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    }
    const action = String(body["action"]);
    const params = (body["params"] ?? {}) as Record<string, unknown>;
    anki.push({ action, params });
    const result = (() => {
      switch (action) {
        case "version":
          return 6;
        case "deckNames":
          return [
            "Kenning::Nederlands",
            "Opmaat::Thema 01 - Kennismaken",
            "Opmaat::Thema 02 - Wonen",
          ];
        case "notesInfo":
          return (params["notes"] as number[]).map((id) => ({
            noteId: id,
            modelName: "x",
            tags: [],
            fields: {},
            cards: [id * 10],
          }));
        case "cardsInfo":
          return (params["cards"] as number[]).map((cardId) => ({
            cardId,
            note: cardId / 10,
            deckName: "Opmaat::Thema 01 - Kennismaken",
            modelName: "x",
            interval: 0,
            type: NOTES[cardId / 10]?.type ?? 0,
            queue: NOTES[cardId / 10]?.queue ?? 0,
            reps: 0,
            lapses: 0,
            due: 1,
          }));
        case "modelNames":
          return ["Kenning Word"];
        case "addNote":
          return 100;
        default:
          return null;
      }
    })();
    return Response.json({ result, error: null });
  });
  vi.stubGlobal("fetch", fetchFn);
  return { anki, uploads, state };
}

let repoToClose: KenningRepository | null = null;
afterEach(async () => {
  vi.unstubAllGlobals();
  await repoToClose?.close();
  repoToClose = null;
});

async function setup() {
  const backend = fakeBackend();
  const repo = await createRepository(await createNodeDriver(":memory:"));
  repoToClose = repo;
  await repo.append({
    type: "AnkiSnapshotImported",
    lang: "nl",
    sources: ["Opmaat::Thema 01 - Kennismaken"],
    entries: [
      {
        key: "naam",
        state: "unknown",
        pKnown: 0,
        noteIds: [7],
        decks: ["Opmaat::Thema 01 - Kennismaken"],
      },
      {
        key: "straat",
        state: "unknown",
        pKnown: 0,
        noteIds: [8],
        decks: ["Opmaat::Thema 01 - Kennismaken"],
      },
      {
        key: "wonen",
        state: "known",
        pKnown: 0.95,
        noteIds: [9],
        decks: ["Opmaat::Thema 01 - Kennismaken"],
      },
    ],
  });
  return { backend, repo, services: createLiveServices(repo) };
}

describe("live courses", () => {
  it("imports photos through the OCR job, then builds outline, words, texts and status", async () => {
    const { backend, services } = await setup();
    const progress: string[] = [];
    const files = [new File(["a"], "p1.jpg"), new File(["b"], "p2.jpg")];
    const id = await services.importCourse({ kind: "images", files, title: "Mijn boek" }, (p) =>
      progress.push(`${p.stage} ${p.done}/${p.total}`),
    );
    expect(backend.uploads).toEqual(["p1.jpg", "p2.jpg"]);
    expect(progress.slice(0, 2)).toEqual(["ocr 1/3", "ocr 3/3"]);

    expect(await services.outline(id)).toEqual([
      { title: "Thema 1 Kennismaken", pages: [2, 2], kind: "theme" },
      { title: "Woordenlijst", pages: [3, 3], kind: "wordlist" },
    ]);
    // The editor refuses broken outlines.
    await expect(
      services.editOutline(id, [{ title: "A", pages: [1, 9], kind: "theme" }]),
    ).rejects.toThrow("only 3 pages");

    const mapping = await services.deckMapping(id);
    expect(mapping.suggested[1]).toEqual(["Opmaat::Thema 01 - Kennismaken"]);
    await services.mapDecks(id, { 1: mapping.suggested[1] ?? [] });
    await services.analyzeCourse(id);

    const unit = await services.unit(id, 1);
    expect(unit?.unit.ankiDecks).toEqual(["Opmaat::Thema 01 - Kennismaken"]);
    expect(unit?.words.map((w) => [w.lemma, w.state])).toEqual([
      ["naam", "unknown"],
      ["straat", "unknown"],
      ["wonen", "known"],
      ["fiets", "absent"],
    ]);
    expect(unit?.status).toMatchObject({ total: 4, known: 1, newInAnki: 2, missing: 1 });
    expect(unit?.exercises.map((e) => e.number)).toEqual([1]);
    // The reading text is in the Library, tagged with the course and unit.
    const text = unit?.texts[0];
    expect(text?.kind).toBe("text");
    expect(text?.textId).toBeDefined();
    const list = await services.listTexts();
    expect(list.map((t) => t.title)).toContain("Thema 1 Kennismaken · Oefening 1");

    const courses = await services.courseList();
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({ unitCount: 2, continueUnit: 1 });
    expect(courses[0]?.course.title).toBe("Mijn boek");
  });

  it("Learn next for a unit moves its new cards in book order and logs each word", async () => {
    const { backend, repo, services } = await setup();
    const id = await services.importCourse({ kind: "pdf", files: [new File(["%PDF"], "b.pdf")] });
    await services.analyzeCourse(id);
    backend.anki.length = 0;

    expect(await services.learnNextForUnit(id, 1)).toEqual({ moved: 2, skipped: 2 });
    const reposition = backend.anki.find((c) => c.action === "scheduling.repositionNewCards");
    expect(reposition?.params["cardIds"]).toEqual(["70", "80"]);
    expect(backend.anki.find((c) => c.action === "unsuspend")?.params["cards"]).toEqual([80]);
    // Nothing else is written: no answers, no due dates.
    expect(backend.anki.map((c) => c.action)).not.toContain("setDueDate");
    const logged = (await repo.events()).filter((e) => e.event.type === "CardsPrioritized");
    expect(logged.map((e) => (e.event.type === "CardsPrioritized" ? e.event.key : ""))).toEqual([
      "naam",
      "straat",
    ]);
    expect(await services.unitStatus(id, 1)).toMatchObject({ learning: 2, newInAnki: 0 });

    const added = await services.addMissingUnitWords(id, 1);
    expect(added).toMatchObject({ added: 1, failed: 0 });
    const note = backend.anki.find((c) => c.action === "addNote")?.params["note"] as {
      fields: { Word: string };
      tags: string[];
    };
    expect(note.fields.Word).toBe("de fiets");
    expect(note.tags).toContain("kenning::course::b::1");
  });

  it("remembers a started import, so leaving the wizard does not lose the reading job", async () => {
    const { backend, services } = await setup();
    backend.state.failPoll = 2;
    await expect(
      services.importCourse({ kind: "pdf", files: [new File(["%PDF"], "boek.pdf")] }),
    ).rejects.toThrow();
    expect(await services.pendingImport()).toMatchObject({ jobId: "j1", title: "boek", total: 3 });
    const id = await services.resumeImport();
    expect((await services.outline(id)).map((r) => r.title)).toEqual([
      "Thema 1 Kennismaken",
      "Woordenlijst",
    ]);
    expect(await services.pendingImport()).toBeNull();
  });

  it("previews and adds unit words to Anki with a sentence from the book, skipping notes that exist", async () => {
    const { backend, services } = await setup();
    const id = await services.importCourse({ kind: "pdf", files: [new File(["%PDF"], "b.pdf")] });
    await services.mapDecks(id, { 1: ["Opmaat::Thema 01 - Kennismaken"] });
    await services.analyzeCourse(id);
    const preview = await services.addWordsPreview(id, 1);
    expect(preview.rows.map((r) => [r.lemma, r.status])).toEqual([
      ["naam", "in-anki"],
      ["straat", "in-anki"],
      ["wonen", "known"],
      ["fiets", "new"],
    ]);
    const fiets = preview.rows.find((r) => r.lemma === "fiets");
    expect(fiets?.article).toBe("de");
    expect(fiets?.example).toBe("Ze fietst elke dag naar haar werk, ook als het regent.");
    expect(preview.options).toContain(preview.decks[1]);

    backend.anki.length = 0;
    const r = await services.addUnitWords(id, "all", { deck: "Kenning::Nederlands" });
    expect(r).toMatchObject({ added: 1, failed: 0, deck: "Kenning::Nederlands" });
    const note = backend.anki.find((c) => c.action === "addNote")?.params["note"] as {
      deckName: string;
      fields: { Word: string; Sentence: string };
    };
    expect(note.deckName).toBe("Kenning::Nederlands");
    expect(note.fields.Word).toBe("de fiets");
    expect(note.fields.Sentence).toContain("fietst elke dag");
  });

  it("checks answers to exercises generated for the unit like book exercises", async () => {
    const { repo, services } = await setup();
    const id = await services.importCourse({ kind: "pdf", files: [new File(["%PDF"], "b.pdf")] });
    await repo.append({
      type: "UnitExercisesGenerated",
      courseId: id,
      unitN: 1,
      rejected: 2,
      provider: "custom",
      model: "m",
      exercises: [
        {
          number: 1001,
          page: 2,
          instruction: "Fill in.",
          type: "gapfill",
          raw: "",
          items: [
            {
              prompt: "Ik ____ (wonen) hier.",
              hint: "wonen",
              answer: "woon",
              answerSource: "ai",
              confidence: 1,
            },
          ],
        },
      ],
    });
    expect((await services.unit(id, 1))?.generated.map((e) => e.number)).toEqual([1001]);
    expect(await services.checkBookItem(id, 1, 1001, 0, "woon")).toMatchObject({ correct: true });
    expect((await services.unit(id, 1))?.generated[0]?.answers[0]).toEqual({
      answer: "woon",
      correct: true,
    });
  });
});
