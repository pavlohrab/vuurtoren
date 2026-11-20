import { describe, expect, it } from "vitest";
import {
  type BookExercise,
  type CourseContent,
  type OcrPage,
  CoursePackError,
  PACK_VERSION,
  applyStructure,
  assignKinds,
  buildCoursePack,
  compareFingerprints,
  itemKey,
  packExercises,
  packFileName,
  pagesFingerprint,
  parseCoursePack,
  segmentPages,
  stripRunningText,
  structureOnly,
  summarizePack,
} from "../index.js";

const PROSE = "Anne woont in Nijmegen en werkt bij een groot bedrijf in de stad.";
const PAGES: OcrPage[] = [
  { n: 1, text: "Inhoud\n1 Kennismaken ........ 2" },
  {
    n: 2,
    text: `Oefening 1 Vul in.\n1 Anne _____ (wonen) in Nijmegen.\n2 Ik _____ (werken) hier.\n\n${PROSE}`,
  },
  { n: 3, text: "Thema 1\nde naam\nhet huis" },
];

function content(): CourseContent {
  const units = [
    {
      courseId: "c",
      n: 1,
      title: "Thema 1 Kennismaken",
      pages: [1, 2] as [number, number],
      kind: "theme" as const,
      ankiDecks: ["Boek::Thema 01"],
    },
    {
      courseId: "c",
      n: 2,
      title: "Woordenlijst",
      pages: [3, 3] as [number, number],
      kind: "wordlist" as const,
      ankiDecks: [],
    },
  ];
  const exercise: BookExercise = {
    number: 1,
    page: 2,
    instruction: "Vul in.",
    type: "gapfill",
    raw: "Vul in.\n1 Anne _____ (wonen) in Nijmegen.",
    items: [
      {
        prompt: "Anne ____ (wonen) in Nijmegen.",
        hint: "wonen",
        answer: "woont",
        answerSource: "user",
        confidence: 1,
      },
      {
        prompt: "Ik ____ (werken) hier.",
        hint: "werken",
        answer: "werk",
        answerSource: "derived",
        confidence: 0.9,
      },
    ],
  };
  return {
    course: {
      id: "c",
      title: "Mijn Boek A2",
      lang: "nl",
      source: { kind: "pdf", filename: "boek.pdf" },
      pageCount: 3,
      created: 1,
    },
    units,
    blocks: assignKinds(segmentPages(stripRunningText(PAGES)), units),
    exercises: new Map([[1, [exercise]]]),
    words: new Map([
      [
        1,
        [
          {
            lemma: "naam",
            article: "de",
            gloss: "name",
            source: "wordlist" as const,
            example: "Mijn naam is Anne.",
            page: 2,
          },
        ],
      ],
    ]),
  };
}

describe("course packs", () => {
  it("builds a full pack that validates and reads back to the same exercises", () => {
    const pack = buildCoursePack(content(), "full", { now: 0 });
    expect(pack).toMatchObject({
      format: "vuurtoren-course-pack",
      version: PACK_VERSION,
      mode: "full",
    });
    const again = parseCoursePack(JSON.parse(JSON.stringify(pack)));
    expect(packExercises(again.units[0]!)).toEqual(content().exercises.get(1));
    expect(again.units[0]?.words[0]).toMatchObject({
      lemma: "naam",
      gloss: "name",
      example: "Mijn naam is Anne.",
    });
    expect(again.blocks?.length).toBeGreaterThan(0);
    expect(summarizePack(again)).toMatchObject({ words: 1, exercises: 1, items: 2, answers: 2 });
  });

  it("leaves every piece of the book's text out of a structure pack", () => {
    const full = buildCoursePack(content(), "full");
    for (const pack of [buildCoursePack(content(), "structure"), structureOnly(full)]) {
      const json = JSON.stringify(pack);
      expect(json).not.toContain("Nijmegen");
      expect(json).not.toContain("Vul in");
      expect(json).not.toContain("Mijn naam");
      expect(pack.blocks).toBeUndefined();
      expect(pack.units[0]?.exercises[0]?.items[0]).toMatchObject({
        answer: "woont",
        key: itemKey("Anne ____ (wonen) in Nijmegen."),
      });
      expect(parseCoursePack(JSON.parse(json)).mode).toBe("structure");
    }
    expect(JSON.stringify(structureOnly(full))).toBe(
      JSON.stringify({ ...buildCoursePack(content(), "structure"), exported: full.exported }),
    );
  });

  it("matches a structure pack to the same pages by fingerprint, and not to another book", () => {
    const pack = buildCoursePack(content(), "structure");
    expect(compareFingerprints(pack, 3, pagesFingerprint(PAGES))).toMatchObject({
      ratio: 1,
      samePageCount: true,
    });
    const other = PAGES.map((p) => ({ ...p, text: `Hoofdstuk ${p.n}\nEen ander boek.` }));
    expect(compareFingerprints(pack, 3, pagesFingerprint(other)).ratio).toBe(0);
  });

  it("lays a structure pack's types and answers over the exercises of your own import", () => {
    const pack = buildCoursePack(content(), "structure");
    const own: BookExercise[] = [
      {
        number: 1,
        page: 2,
        instruction: "Vul in.",
        type: "unknown",
        raw: "",
        items: [
          // Spacing and blanks differ from the exporter's OCR: the key ignores them.
          { prompt: "Anne _____ (wonen)  in Nijmegen .", answerSource: "user", confidence: 0 },
          { prompt: "Ik ____ (werken) hier!", answerSource: "user", confidence: 0 },
        ],
      },
    ];
    const r = applyStructure(own, [
      ...(pack.units[0]?.exercises ?? []),
      { number: 9, page: 2, type: "choice", items: [] },
    ]);
    expect(r).toMatchObject({ matched: 1, missing: 1, items: 2 });
    expect(r.exercises[0]?.type).toBe("gapfill");
    expect(r.exercises[0]?.items.map((i) => [i.prompt, i.answer, i.answerSource])).toEqual([
      ["Anne _____ (wonen)  in Nijmegen .", "woont", "user"],
      ["Ik ____ (werken) hier!", "werk", "derived"],
    ]);
  });

  it("rejects files that are not packs, newer versions and broken packs with a clear message", () => {
    const good = JSON.parse(JSON.stringify(buildCoursePack(content(), "full"))) as Record<
      string,
      unknown
    >;
    expect(() => parseCoursePack({ hello: 1 })).toThrow("not a Vuurtoren course pack");
    expect(() => parseCoursePack({ ...good, version: PACK_VERSION + 1 })).toThrow(
      /newer version of Vuurtoren/,
    );
    expect(() => parseCoursePack({ ...good, version: 0 })).toThrow(CoursePackError);
    expect(() => parseCoursePack({ ...good, mode: "half" })).toThrow("mode");
    expect(() => parseCoursePack({ ...good, blocks: undefined })).toThrow("needs the book's text");
    expect(() => parseCoursePack({ ...good, mode: "structure" })).toThrow("must not contain");
    const units = good["units"] as Record<string, unknown>[];
    expect(() => parseCoursePack({ ...good, units: [{ ...units[0], pages: [2, 9] }] })).toThrow(
      "page range",
    );
    expect(() =>
      parseCoursePack({
        ...good,
        units: [{ ...units[0], exercises: [{ number: 1, page: 2, type: "essay", items: [] }] }],
      }),
    ).toThrow("unknown type");
    // A grammar chapter may name its topic page; the name must be text.
    const grammar = { page: 2, kind: "grammar", label: "1.2 modale verba", text: "kunnen" };
    expect(
      parseCoursePack({ ...good, blocks: [{ ...grammar, topic: "modal-verbs" }] }).blocks,
    ).toHaveLength(1);
    expect(() => parseCoursePack({ ...good, blocks: [{ ...grammar, topic: 3 }] })).toThrow(
      "text block",
    );
  });

  it("names files after the course", () => {
    expect(packFileName("De Opmaat A2", "full")).toBe("de-opmaat-a2.vuurtoren-course.json");
    expect(packFileName("De Opmaat A2", "structure")).toBe(
      "de-opmaat-a2.structure.vuurtoren-course.json",
    );
  });
});
