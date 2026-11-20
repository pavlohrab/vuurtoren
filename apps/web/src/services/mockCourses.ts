/**
 * Courses for the demo (`?demo`) and UI tests: one invented course, "Nederlands voor beginners",
 * kept in memory. It exercises every feature (outline editing, deck mapping, all exercise types,
 * derived answers, unit status, Learn next) without any real book content.
 */
import {
  type BookExercise,
  type Course,
  type Exercise,
  type Unit,
  type UnitWord,
  buildCoursePack,
  checkBookItem,
  packExercises,
  packFileName,
  packUnits,
  suggestDecks,
  unitStatus,
  validateOutline,
} from "@app/core";
import type {
  AddMissingResult,
  AddWordsPreview,
  BookCheckResult,
  BookExerciseView,
  CourseListItem,
  CourseServices,
  CourseView,
  DeckMapping,
  ImportProgress,
  LearnNextResult,
  OutlineRow,
  UnitRow,
  UnitView,
  UnitWordView,
} from "./courseTypes.js";

const DEMO_DECKS = [
  "Nederlands voor beginners::Thema 1 - Kennismaken",
  "Nederlands voor beginners::Thema 2 - Winkelen",
  "Nederlands voor beginners::Thema 3 - Wonen",
  "Vuurtoren::Nederlands",
];

const COURSE_ID = "demo-course";

const demoCourse = (): Course => ({
  id: COURSE_ID,
  title: "Nederlands voor beginners",
  lang: "nl",
  level: "A2",
  source: { kind: "pdf", filename: "voorbeeld.pdf" },
  pageCount: 60,
  created: 1_700_000_000_000,
});

const demoUnits = (): Unit[] => [
  {
    courseId: COURSE_ID,
    n: 1,
    title: "Thema 1 Kennismaken",
    pages: [3, 20],
    ankiDecks: [DEMO_DECKS[0]!],
    kind: "theme",
  },
  {
    courseId: COURSE_ID,
    n: 2,
    title: "Thema 2 Winkelen",
    pages: [21, 40],
    ankiDecks: [],
    kind: "theme",
  },
  {
    courseId: COURSE_ID,
    n: 3,
    title: "Thema 3 Wonen",
    pages: [41, 55],
    ankiDecks: [],
    kind: "theme",
  },
  {
    courseId: COURSE_ID,
    n: 4,
    title: "Grammatica",
    pages: [56, 60],
    ankiDecks: [],
    kind: "grammar",
  },
];

const w = (lemma: string, article?: string, gloss?: string): UnitWord => ({
  lemma,
  source: "wordlist",
  ...(article ? { article } : {}),
  ...(gloss ? { gloss } : {}),
});

const demoWords = (): Map<number, UnitWord[]> =>
  new Map([
    [
      1,
      [
        w("wonen", undefined, "to live"),
        w("heten", undefined, "to be called"),
        w("buurman", "de", "neighbour"),
        w("komen"),
        w("werken", undefined, "to work"),
        w("stad", "de", "city"),
      ],
    ],
    [
      2,
      [
        w("winkel", "de", "shop"),
        w("kopen", undefined, "to buy"),
        w("brood", "het", "bread"),
        w("betalen", undefined, "to pay"),
      ],
    ],
    [
      3,
      [w("huis", "het", "house"), w("kamer", "de", "room"), w("verhuizen", undefined, "to move")],
    ],
  ]);

const item = (
  prompt: string,
  hint: string | undefined,
  answer: string | undefined,
  confidence: number,
  source: "derived" | "book" | "user" | "ai" = "derived",
) => ({
  prompt,
  ...(hint ? { hint } : {}),
  ...(answer ? { answer } : {}),
  answerSource: source,
  confidence,
});

const demoExercises = (): Map<number, BookExercise[]> =>
  new Map([
    [
      1,
      [
        {
          number: 1,
          page: 5,
          instruction: "Vul de goede vorm van het verbum in.",
          type: "gapfill",
          example: "Ik ____ (werken) in Utrecht. Ik werk in Utrecht.",
          raw: "",
          items: [
            item("Anne ____ (wonen) in Nijmegen.", "wonen", "woont", 0.9),
            item("Willem en Mila ____ (komen) uit Peru.", "komen", "komen", 0.9),
            item("Hoe ____ (heten) jij?", "heten", "heet", 0.7),
            item("Zij ____ (werken) in een winkel.", "werken", "werkt", 0.5),
          ],
        },
        {
          number: 2,
          page: 7,
          instruction: "Maak zinnen.",
          type: "sentence-building",
          raw: "",
          items: [
            {
              prompt: "in / woont / Anne / Utrecht",
              chunks: ["in", "woont", "Anne", "Utrecht"],
              answer: "Anne woont in Utrecht",
              answerSource: "user",
              confidence: 1,
            },
            {
              prompt: "werkt / hij / in een winkel",
              chunks: ["werkt", "hij", "in een winkel"],
              answerSource: "user",
              confidence: 0,
            },
          ],
        },
        {
          number: 3,
          page: 9,
          instruction: "Maak het schema compleet.",
          type: "conjugation-table",
          raw: "",
          items: [
            item("ik ____ (wonen)", "wonen", "woon", 0.95),
            item("jij ____ (wonen)", "wonen", "woont", 0.95),
            item("wij ____ (wonen)", "wonen", "wonen", 0.95),
          ],
        },
        {
          number: 4,
          page: 11,
          instruction: "Kies het goede woord.",
          type: "choice",
          raw: "",
          items: [
            {
              prompt: "Ik ____ Anne.",
              options: ["ben", "bent", "is"],
              answer: "ben",
              answerSource: "user",
              confidence: 1,
            },
          ],
        },
        {
          number: 5,
          page: 12,
          instruction: "Schrijf een korte tekst over jezelf.",
          type: "open-task",
          raw: "Schrijf een korte tekst over jezelf. Gebruik minstens vijf zinnen.",
          items: [],
        },
        {
          number: 6,
          page: 13,
          instruction: "Combineer.",
          type: "unknown",
          raw: "Combineer de vragen met de antwoorden.\n1 Hoe heet je? a In Utrecht.\n2 Waar woon je? b Ik heet Anne.",
          items: [],
        },
      ],
    ],
    [
      2,
      [
        {
          number: 1,
          page: 23,
          instruction: "Vul de goede vorm van het verbum in.",
          type: "gapfill",
          raw: "",
          items: [
            item("Wij ____ (kopen) brood bij de bakker.", "kopen", "kopen", 0.9),
            item("Gisteren ____ (betalen) ik contant.", "betalen", "betaalde", 0.7),
          ],
        },
      ],
    ],
  ]);

/** Exercises "made for this unit" in the demo (as if generated with AI and validated). */
const demoGenerated = (): Map<number, BookExercise[]> =>
  new Map([
    [
      1,
      [
        {
          number: 1001,
          page: 3,
          instruction: "Fill in the right form of the word in brackets.",
          type: "gapfill",
          raw: "",
          items: [
            item("Mijn buurman ____ (werken) in de stad.", "werken", "werkt", 1, "ai"),
            item("Hoe ____ (heten) jouw buurman?", "heten", "heet", 1, "ai"),
          ],
        },
        {
          number: 1002,
          page: 3,
          instruction: "Make sentences: put the words in the right order.",
          type: "sentence-building",
          raw: "",
          grammar: "inversion",
          items: [
            {
              prompt: "in de stad / Morgen / ik / werk",
              chunks: ["in de stad", "Morgen", "ik", "werk"],
              answer: "Morgen werk ik in de stad.",
              answerSource: "ai",
              confidence: 1,
            },
          ],
        },
      ],
    ],
  ]);

const wait = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

/** Demo course services (in memory). */
export function createMockCourses(opts: { latencyMs?: number } = {}): CourseServices {
  const latency = opts.latencyMs ?? 40;
  let course: Course | null = null;
  let units: Unit[] = [];
  let words = new Map<number, UnitWord[]>();
  let exercises = new Map<number, BookExercise[]>();
  let generated = new Map<number, BookExercise[]>();
  const answers = new Map<string, { answer: string; correct: boolean }>();
  const states = new Map<string, "known" | "learning" | "unknown">([
    ["wonen", "known"],
    ["heten", "known"],
    ["komen", "learning"],
    ["winkel", "learning"],
  ]);
  const inAnki = new Set(["wonen", "heten", "komen", "winkel", "buurman", "werken", "kopen"]);
  const akey = (n: number, num: number, i: number) => `${n}/${num}/${i}`;

  const load = () => {
    course = demoCourse();
    units = demoUnits();
    words = demoWords();
    exercises = demoExercises();
    generated = demoGenerated();
  };
  const findEx = (n: number, number: number) =>
    [...(exercises.get(n) ?? []), ...(generated.get(n) ?? [])].find((e) => e.number === number);
  load();

  const wordView = (word: UnitWord): UnitWordView => {
    const here = inAnki.has(word.lemma);
    return {
      ...word,
      key: word.lemma,
      state: here ? (states.get(word.lemma) ?? "unknown") : "absent",
      inAnki: here,
      decks: here ? ["Nederlands voor beginners"] : [],
    };
  };
  const statusOf = (n: number) => {
    const ws = (words.get(n) ?? []).map(wordView);
    const exs = exercises.get(n) ?? [];
    const answered = new Map<number, number>();
    for (const e of exs) {
      const done = e.items.filter((_, i) => answers.get(akey(n, e.number, i))?.correct).length;
      answered.set(e.number, done);
    }
    return unitStatus(
      ws.map((x) => ({ state: x.state, inAnki: x.inAnki })),
      exs.map((e) => ({ number: e.number, items: e.items.length })),
      answered,
    );
  };
  const exerciseView = (n: number, e: BookExercise): BookExerciseView => ({
    ...e,
    answers: e.items.map((_, i) => answers.get(akey(n, e.number, i)) ?? {}),
  });

  return {
    async exportCoursePack(_id, mode) {
      if (!course) throw new Error("This course no longer exists.");
      const pack = buildCoursePack(
        {
          course,
          units,
          blocks: units.map((u) => ({ page: u.pages[0], kind: "other", text: u.title })),
          exercises,
          words,
        },
        mode,
        { meta: { generator: "Vuurtoren demo" } },
      );
      return { fileName: packFileName(course.title, mode), json: JSON.stringify(pack, null, 1) };
    },
    async importCoursePack(pack, opts = {}) {
      if (pack.mode === "structure" && !opts.files?.length)
        throw new Error("Choose your copy of the book: a structure pack has no text.");
      opts.onProgress?.({ stage: "outline", done: 1, total: 1, message: "Creating the course" });
      await wait(latency);
      course = {
        id: COURSE_ID,
        title: pack.course.title,
        lang: pack.course.lang,
        source: pack.course.source,
        pageCount: pack.course.pageCount,
        created: Date.now(),
      };
      units = packUnits(pack, COURSE_ID);
      words = new Map(pack.units.map((u) => [u.n, u.words]));
      if (pack.mode === "full") exercises = new Map(pack.units.map((u) => [u.n, packExercises(u)]));
      generated = new Map();
      return {
        courseId: COURSE_ID,
        units: units.length,
        words: pack.units.reduce((n, u) => n + u.words.length, 0),
        exercises: pack.units.reduce((n, u) => n + u.exercises.length, 0),
        texts: 0,
        textsFailed: 0,
      };
    },
    async importCourse(input, onProgress) {
      const total = 6;
      for (let i = 1; i <= total; i++) {
        onProgress?.({
          stage: "ocr",
          done: i,
          total,
          message: `Reading page ${i} of ${total}`,
        } satisfies ImportProgress);
        await wait(latency);
      }
      load();
      if (course && input.title) course.title = input.title;
      return COURSE_ID;
    },
    async analyzeCourse(_id, onProgress) {
      onProgress?.({ stage: "exercises", done: 1, total: 1, message: "Recognising exercises" });
      await wait(latency);
      onProgress?.({ stage: "done", done: 1, total: 1, message: "Done" });
    },
    async courseList(): Promise<CourseListItem[]> {
      await wait(latency);
      if (!course) return [];
      const themes = units.filter((u) => u.kind === "theme");
      const st = themes.map((u) => statusOf(u.n)).filter((s) => s.total > 0);
      const known = st.reduce((a, s) => a + s.known, 0);
      const total = st.reduce((a, s) => a + s.total, 0);
      const open = themes.find((u) => {
        const s = statusOf(u.n);
        return s.exercisesDone < s.exercisesTotal || s.knownRatio < 1;
      });
      return [
        {
          course,
          unitCount: units.length,
          knownRatio: total ? known / total : null,
          continueUnit: open?.n ?? null,
          ...(open
            ? {
                continueTitle: open.title,
                continueKnown: statusOf(open.n).total > 0 ? statusOf(open.n).knownRatio : null,
              }
            : {}),
        },
      ];
    },
    async course(id): Promise<CourseView | null> {
      await wait(latency);
      if (!course || id !== course.id) return null;
      const rows: UnitRow[] = units.map((unit) => ({ unit, status: statusOf(unit.n) }));
      return { course, units: rows, ankiReady: true };
    },
    async deleteCourse() {
      await wait(latency);
      course = null;
      units = [];
    },
    async outline(): Promise<OutlineRow[]> {
      await wait(latency);
      return units.map((u) => ({ title: u.title, pages: u.pages, kind: u.kind }));
    },
    async editOutline(_id, rows) {
      await wait(latency);
      const problem = validateOutline(rows, course?.pageCount ?? 0);
      if (problem) throw new Error(problem);
      units = rows.map((r, i) => ({
        courseId: COURSE_ID,
        n: i + 1,
        title: r.title,
        pages: r.pages,
        kind: r.kind,
        ankiDecks: units[i]?.ankiDecks ?? [],
      }));
    },
    async deckMapping(): Promise<DeckMapping> {
      await wait(latency);
      const sug = suggestDecks(units, DEMO_DECKS);
      return {
        decks: DEMO_DECKS,
        suggested: Object.fromEntries(sug.map((s) => [s.n, s.decks])),
        current: Object.fromEntries(units.map((u) => [u.n, u.ankiDecks])),
      };
    },
    async mapDecks(_id, mapping) {
      await wait(latency);
      units = units.map((u) => ({ ...u, ankiDecks: mapping[u.n] ?? u.ankiDecks }));
    },
    async unit(_id, n): Promise<UnitView | null> {
      await wait(latency);
      const unit = units.find((u) => u.n === n);
      if (!course || !unit) return null;
      return {
        course,
        unit,
        status: statusOf(n),
        texts:
          unit.kind === "theme"
            ? [
                {
                  label: "Lezen: Een nieuwe buurman",
                  kind: "text",
                  page: unit.pages[0] + 4,
                  words: 120,
                },
                { label: "Luistertekst 1", kind: "transcript", page: 58, words: 90 },
              ]
            : [],
        exercises: (exercises.get(n) ?? []).map((e) => exerciseView(n, e)),
        generated: (generated.get(n) ?? []).map((e) => exerciseView(n, e)),
        words: (words.get(n) ?? []).map(wordView),
        grammar:
          unit.kind === "theme"
            ? [
                {
                  title: "Presens",
                  text: "Bij ik is de stam het werkwoord zonder -en. Bij jij en hij komt er een -t bij.",
                },
              ]
            : [],
      };
    },
    async pendingImport() {
      return null;
    },
    async resumeImport() {
      throw new Error("There is no unfinished import.");
    },
    async discardPendingImport() {},
    async pagePreviews() {
      await wait(latency);
      const firsts = new Map(units.map((u) => [u.pages[0], u.title]));
      return Array.from({ length: course?.pageCount ?? 0 }, (_, i) => {
        const n = i + 1;
        const head = firsts.get(n);
        return {
          n,
          lines: head
            ? [head, "Lezen: Een nieuwe buurman"]
            : n % 3 === 0
              ? [`Oefening ${n % 12}`, "Vul de goede vorm van het verbum in."]
              : ["Tekst", "Anne woont in Nijmegen. Ze werkt in een winkel."],
        };
      });
    },
    async addWordsPreview(_id, scope): Promise<AddWordsPreview> {
      await wait(latency);
      const ns =
        scope === "all" ? units.filter((u) => u.kind === "theme").map((u) => u.n) : [scope];
      const rows = ns.flatMap((n) =>
        (words.get(n) ?? []).map((wd) => ({
          key: wd.lemma,
          lemma: wd.lemma,
          unitN: n,
          status: (states.get(wd.lemma) === "known"
            ? "known"
            : inAnki.has(wd.lemma)
              ? "in-anki"
              : "new") as "known" | "in-anki" | "new",
          ...(wd.article ? { article: wd.article } : {}),
          ...(wd.gloss ? { gloss: wd.gloss } : {}),
          example:
            wd.lemma === "stad"
              ? "Anne woont in een kleine stad."
              : wd.lemma === "brood"
                ? "Wij kopen brood bij de bakker."
                : `Dit is een zin met ${wd.lemma}.`,
        })),
      );
      const decks = Object.fromEntries(
        ns.map((n) => [
          n,
          units.find((u) => u.n === n)?.ankiDecks[0] ??
            `Vuurtoren::Dutch::Nederlands voor beginners::Thema ${n}`,
        ]),
      );
      return { rows, decks, options: [...new Set([...Object.values(decks), ...DEMO_DECKS])] };
    },
    async addUnitWords(_id, scope, opts): Promise<AddMissingResult> {
      await wait(latency);
      const ns =
        scope === "all" ? units.filter((u) => u.kind === "theme").map((u) => u.n) : [scope];
      let added = 0;
      for (const n of ns)
        for (const wd of words.get(n) ?? []) {
          if (inAnki.has(wd.lemma) || (opts?.keys && !opts.keys.includes(wd.lemma))) continue;
          inAnki.add(wd.lemma);
          states.set(wd.lemma, "learning");
          added++;
        }
      return {
        added,
        failed: 0,
        deck: opts?.deck ?? "Vuurtoren::Dutch::Nederlands voor beginners",
      };
    },
    async unitGrammar(_id, n) {
      await wait(latency);
      if (units.find((u) => u.n === n)?.kind !== "theme") return [];
      return [
        {
          topicId: "word-order-v2",
          title: "Word order in main clauses (V2)",
          level: "A1",
          summary: "In a main clause the conjugated verb is always the second element.",
          count: 14,
          example: "Anne woont in Nijmegen.",
        },
        {
          topicId: "inversion",
          title: "Inversion",
          level: "A2",
          summary:
            "When something other than the subject comes first, the verb jumps in front of the subject.",
          count: 6,
          example: "Morgen werk ik in de stad.",
        },
      ];
    },
    async unitStatus(_id, n) {
      await wait(latency);
      return statusOf(n);
    },
    async learnNextForUnit(_id, n): Promise<LearnNextResult> {
      await wait(latency);
      let moved = 0;
      let skipped = 0;
      for (const wd of words.get(n) ?? []) {
        if (inAnki.has(wd.lemma) && !states.has(wd.lemma)) {
          states.set(wd.lemma, "learning");
          moved++;
        } else skipped++;
      }
      return { moved, skipped };
    },
    async addMissingUnitWords(_id, n, opts): Promise<AddMissingResult> {
      await wait(latency);
      let added = 0;
      for (const wd of words.get(n) ?? []) {
        if (!inAnki.has(wd.lemma)) {
          inAnki.add(wd.lemma);
          states.set(wd.lemma, "learning");
          added++;
        }
      }
      return { added, failed: 0, deck: opts?.deck ?? `Vuurtoren::Nederlands::Opmaat::Thema ${n}` };
    },
    async unitPractice(): Promise<Exercise[]> {
      await wait(latency);
      return MOCK_UNIT_EXERCISES;
    },
    async moreLikeThis(): Promise<Exercise[]> {
      await wait(latency);
      return MOCK_UNIT_EXERCISES.slice(0, 2);
    },
    async checkBookItem(_id, n, number, i, answer): Promise<BookCheckResult> {
      await wait(latency);
      const ex = findEx(n, number);
      const it = ex?.items[i];
      if (!ex || !it) return { correct: null };
      const res = checkBookItem(ex.type, it, answer);
      if (res.correct !== null) answers.set(akey(n, number, i), { answer, correct: res.correct });
      else answers.set(akey(n, number, i), { answer, correct: false });
      return { ...res, ...(it.answer ? { expected: it.answer } : {}) };
    },
    async setBookAnswer(_id, n, number, i, answer) {
      await wait(latency);
      const ex = (exercises.get(n) ?? []).find((e) => e.number === number);
      const it = ex?.items[i];
      if (it) {
        it.answer = answer;
        it.answerSource = "user";
        it.confidence = 1;
      }
    },
    async editBookExercise(_id, n, number, patch) {
      await wait(latency);
      const ex = (exercises.get(n) ?? []).find((e) => e.number === number);
      if (ex) Object.assign(ex, patch);
    },
    async unitBlocks() {
      await wait(latency);
      return [];
    },
  };
}

/** A small fixed set of generated exercises for the demo practice tab. */
const MOCK_UNIT_EXERCISES: Exercise[] = [
  {
    id: "mock-course-1",
    kind: "verb-form",
    skill: "form",
    key: "wonen",
    instruction: "Give the form",
    prompt: { text: "wonen: present, ik" },
    answer: "woon",
  },
  {
    id: "mock-course-2",
    kind: "cloze-typed",
    skill: "recall",
    key: "winkel",
    instruction: "Type the missing word",
    prompt: {
      text: "Ik koop brood in de ____.",
      sentence: "Ik koop brood in de winkel.",
      translation: "I buy bread in the shop.",
      hint: "shop",
    },
    answer: "winkel",
  },
];
