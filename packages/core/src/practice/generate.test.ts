import { describe, expect, it } from "vitest";
import { checkAnswer } from "./check.js";
import { generate } from "./generate.js";
import { createRng } from "./rng.js";
import { nounPool, sentence, word } from "./testutil.js";
import { SKILL_OF, type ExerciseKind } from "./types.js";

const rng = () => createRng(42);
const pool = nounPool();

describe("meaning-choice", () => {
  const hond = word("hond", { article: "de", glosses: ["dog", "hound"] });

  it("shows the lemma with article and 4 gloss choices", () => {
    const e = generate("meaning-choice", hond, [hond, ...pool], rng())!;
    expect(e.kind).toBe("meaning-choice");
    expect(e.skill).toBe("recognition");
    expect(e.key).toBe("hond");
    expect(e.instruction).toBe("Choose the meaning");
    expect(e.prompt.text).toBe("de hond");
    expect(e.answer).toBe("dog");
    expect(e.choices).toHaveLength(4);
    expect(e.choices).toContain("dog");
    expect(new Set(e.choices).size).toBe(4);
  });

  it("returns null without glosses or enough distractors", () => {
    expect(generate("meaning-choice", { ...hond, glosses: [] }, pool, rng())).toBeNull();
    expect(generate("meaning-choice", hond, nounPool(1), rng())).toBeNull();
  });
});

describe("word-choice", () => {
  const hond = word("hond", { glosses: ["dog"] });
  it("prompts with the gloss and offers lemmas", () => {
    const e = generate("word-choice", hond, pool, rng())!;
    expect(e.instruction).toBe("Which Dutch word means “dog”?");
    expect(e.prompt.text).toBe("dog");
    expect(e.answer).toBe("hond");
    expect(e.choices).toContain("hond");
    expect(e.choices).toHaveLength(4);
    expect(e.choices!.filter((c) => c.startsWith("woord"))).toHaveLength(3);
  });
  it("null without glosses", () => {
    expect(generate("word-choice", word("x", { glosses: [] }), pool, rng())).toBeNull();
  });
});

describe("cloze", () => {
  const text = "Ik zie de honden in de tuin.";
  const honden = word("hond", {
    glosses: ["dog"],
    sentences: [sentence(text, "honden", { translation: "I see the dogs in the garden." })],
  });

  it("cloze-typed blanks the surface form and hints the gloss", () => {
    const e = generate("cloze-typed", honden, pool, rng())!;
    expect(e.skill).toBe("recall");
    expect(e.instruction).toBe("Fill in the missing word");
    expect(e.prompt.text).toBe("Ik zie de ____ in de tuin.");
    expect(e.prompt.sentence).toBe(text);
    expect(e.prompt.blank).toEqual([10, 16]);
    expect(e.prompt.hint).toBe("dog");
    expect(e.prompt.translation).toBe("I see the dogs in the garden.");
    expect(e.answer).toBe("honden");
    expect(e.choices).toBeUndefined();
    expect(checkAnswer(e, "Honden").correct).toBe(true);
  });

  it("cloze-choice offers the surface form plus distractor lemmas", () => {
    const e = generate("cloze-choice", honden, pool, rng())!;
    expect(e.skill).toBe("recognition");
    expect(e.answer).toBe("honden");
    expect(e.choices).toHaveLength(4);
    expect(e.choices).toContain("honden");
    expect(e.prompt.text).toContain("____");
  });

  it("capitalises distractors when the blank starts the sentence", () => {
    const w = word("hond", { sentences: [sentence("Honden blaffen luid in de nacht.", "Honden")] });
    const e = generate("cloze-choice", w, pool, rng())!;
    expect(e.choices!.every((c) => c[0] === c[0]!.toUpperCase())).toBe(true);
  });

  it("prefers anki over text over tatoeba, and 5-15 word sentences", () => {
    const w = word("hond", {
      sentences: [
        sentence("Hond.", "Hond", { source: "anki" }),
        sentence("Een hond blaft hier vandaag.", "hond", { source: "tatoeba" }),
        sentence("Mijn hond slaapt de hele dag.", "hond", { source: "text" }),
      ],
    });
    expect(generate("cloze-typed", w, pool, rng())!.prompt.sentence).toBe(
      "Mijn hond slaapt de hele dag.",
    );
    const anki = word("hond", {
      sentences: [
        sentence("Een hond blaft hier vandaag.", "hond", { source: "tatoeba" }),
        sentence("Mijn hond slaapt de hele dag.", "hond", { source: "anki" }),
      ],
    });
    expect(generate("cloze-typed", anki, pool, rng())!.prompt.sentence).toBe(
      "Mijn hond slaapt de hele dag.",
    );
  });

  it("null without usable sentences or distractors", () => {
    const bad = word("hond", { sentences: [{ text: "Hond", target: [3, 3], source: "text" }] });
    expect(generate("cloze-typed", bad, pool, rng())).toBeNull();
    expect(generate("cloze-typed", word("hond"), pool, rng())).toBeNull();
    expect(generate("cloze-choice", honden, [], rng())).toBeNull();
  });
});

describe("gender", () => {
  it("asks de or het", () => {
    const e = generate("gender", word("huis", { article: "het" }), pool, rng())!;
    expect(e.skill).toBe("gender");
    expect(e.instruction).toBe("de or het?");
    expect(e.choices).toEqual(["de", "het"]);
    expect(e.answer).toBe("het");
    expect(e.prompt.text).toBe("huis");
  });
  it("explains diminutives and common suffixes", () => {
    expect(
      generate("gender", word("huisje", { article: "het" }), pool, rng())!.explanation,
    ).toMatch(/always het/);
    expect(
      generate("gender", word("vrijheid", { article: "de" }), pool, rng())!.explanation,
    ).toMatch(/-heid/);
    expect(generate("gender", word("tafel", { article: "de" }), pool, rng())!.explanation).toMatch(
      /de tafel/,
    );
  });
  it("null for non-nouns or nouns without article", () => {
    expect(
      generate("gender", word("lopen", { pos: "VERB", article: "de" }), pool, rng()),
    ).toBeNull();
    expect(generate("gender", word("huis"), pool, rng())).toBeNull();
  });
});

describe("separable", () => {
  const forms = { separable: { particle: "op", stem: "bellen" } };
  const verb = (text: string, surface: string) =>
    word("opbellen", {
      pos: "VERB",
      glosses: ["to call"],
      forms,
      sentences: [sentence(text, surface)],
    });

  it("offers the real sentence among broken variants", () => {
    const e = generate("separable", verb("Ik bel hem morgen op.", "bel"), pool, rng())!;
    expect(e.skill).toBe("form");
    expect(e.instruction).toBe("Choose the correct sentence");
    expect(e.answer).toBe("Ik bel hem morgen op.");
    expect(e.choices).toHaveLength(4);
    expect(e.choices).toContain("Ik opbel hem morgen.");
    expect(e.choices).toContain("Ik op bel hem morgen.");
    expect(e.choices).toContain("Ik bel op hem morgen.");
    expect(new Set(e.choices).size).toBe(4);
  });

  it("skips duplicate variants when the particle is already adjacent", () => {
    const e = generate("separable", verb("Hij belt op.", "belt"), pool, rng())!;
    expect(e.answer).toBe("Hij belt op.");
    expect(e.choices).toEqual(expect.arrayContaining(["Hij opbelt.", "Hij op belt."]));
    expect(new Set(e.choices).size).toBe(e.choices!.length);
  });

  it("handles a sentence-initial verb", () => {
    const e = generate("separable", verb("Bel je hem morgen op?", "Bel"), pool, rng())!;
    expect(e.choices).toContain("Opbel je hem morgen?");
    expect(e.choices).toContain("Op bel je hem morgen?");
  });

  it("null when the sentence has no split form or forms are missing", () => {
    expect(generate("separable", verb("Ik wil hem opbellen.", "opbellen"), pool, rng())).toBeNull();
    expect(generate("separable", word("bellen", { pos: "VERB" }), pool, rng())).toBeNull();
  });
});

describe("perfect", () => {
  const lezen = word("lezen", {
    pos: "VERB",
    glosses: ["to read"],
    forms: { participle: "gelezen", aux: "hebben" },
  });
  const SUBJECTS: Record<string, string> = { Ik: "heb", Hij: "heeft", Wij: "hebben" };

  it("builds a typed perfect-tense prompt", () => {
    const e = generate("perfect", lezen, pool, rng())!;
    const [subject] = e.prompt.text.split(" ");
    expect(e.prompt.text).toMatch(/^(Ik|Hij|Wij) ____ \(lezen\)/);
    expect(e.answer).toBe(`${SUBJECTS[subject!]} gelezen`);
    expect(e.choices).toBeUndefined();
    expect(e.explanation).toMatch(/hebben/);
    expect(checkAnswer(e, e.answer.toUpperCase()).correct).toBe(true);
  });

  it("uses zijn forms and explains motion", () => {
    const gaan = word("gaan", { pos: "VERB", forms: { participle: "gegaan", aux: "zijn" } });
    const answers = new Set<string>();
    for (let seed = 0; seed < 30; seed++)
      answers.add(generate("perfect", gaan, pool, createRng(seed))!.answer);
    expect([...answers].sort()).toEqual(["ben gegaan", "is gegaan", "zijn gegaan"]);
    expect(generate("perfect", gaan, pool, rng())!.explanation).toMatch(/motion/);
  });

  it("accepts the other auxiliary for both", () => {
    const e = generate(
      "perfect",
      word("vliegen", { pos: "VERB", forms: { participle: "gevlogen", aux: "both" } }),
      pool,
      rng(),
    )!;
    expect(e.accept).toHaveLength(1);
    expect(checkAnswer(e, e.accept![0]!).correct).toBe(true);
  });

  it("null without participle/aux", () => {
    expect(
      generate(
        "perfect",
        word("lezen", { pos: "VERB", forms: { participle: "gelezen" } }),
        pool,
        rng(),
      ),
    ).toBeNull();
    expect(generate("perfect", word("lezen", { pos: "VERB" }), pool, rng())).toBeNull();
  });
});

describe("verb-form", () => {
  const lopen = word("lopen", {
    pos: "VERB",
    forms: { past: ["liep", "liepen"], present: { hij: "loopt" } },
  });

  it("picks a slot and asks for the form", () => {
    const seen = new Map<string, string>();
    for (let seed = 0; seed < 40; seed++) {
      const e = generate("verb-form", lopen, pool, createRng(seed))!;
      seen.set(e.prompt.text, e.answer);
      expect(e.instruction).toMatch(/^Put the verb in the (past|present) tense: lopen$/);
    }
    expect(Object.fromEntries(seen)).toEqual({
      "ik ____": "liep",
      "wij ____": "liepen",
      "hij ____": "loopt",
    });
  });

  it("says past tense for past slots", () => {
    const only = word("lopen", { pos: "VERB", forms: { past: ["liep", "liepen"] } });
    expect(generate("verb-form", only, pool, rng())!.instruction).toBe(
      "Put the verb in the past tense: lopen",
    );
  });

  it("null without forms", () => {
    expect(generate("verb-form", word("lopen", { pos: "VERB" }), pool, rng())).toBeNull();
    expect(
      generate("verb-form", word("lopen", { pos: "VERB", forms: {} }), pool, rng()),
    ).toBeNull();
  });
});

describe("adjective-e", () => {
  const mooi = word("mooi", { pos: "ADJ", forms: { inflected: "mooie" } });

  it("covers all templates with correct -e rules", () => {
    const got = new Map<string, string>();
    for (let seed = 0; seed < 60; seed++) {
      const e = generate("adjective-e", mooi, pool, createRng(seed))!;
      expect(e.choices!.slice().sort()).toEqual(["mooi", "mooie"]);
      got.set(e.prompt.text, e.answer);
    }
    expect(Object.fromEntries(got)).toEqual({
      "een ____ huis": "mooi",
      "het ____ huis": "mooie",
      "een ____ man": "mooie",
      "de ____ man": "mooie",
    });
  });

  it("explains the rule", () => {
    const e = generate("adjective-e", mooi, pool, rng())!;
    expect(e.explanation).toContain(e.prompt.text.replace("____", e.answer));
  });

  it("null for non-adjectives or missing/identical inflection", () => {
    expect(generate("adjective-e", word("mooi", { pos: "ADJ" }), pool, rng())).toBeNull();
    expect(
      generate(
        "adjective-e",
        word("prima", { pos: "ADJ", forms: { inflected: "prima" } }),
        pool,
        rng(),
      ),
    ).toBeNull();
    expect(
      generate("adjective-e", word("huis", { forms: { inflected: "x" } }), pool, rng()),
    ).toBeNull();
  });
});

describe("scramble", () => {
  const text = "Ik bel hem morgen op.";
  const w = word("bellen", {
    sentences: [sentence(text, "bel", { translation: "I call him tomorrow." })],
  });

  it("shuffles into a different order and accepts the original", () => {
    for (let seed = 0; seed < 20; seed++) {
      const e = generate("scramble", w, pool, createRng(seed))!;
      expect(e.skill).toBe("form");
      expect(e.instruction).toBe("Put the words in order");
      expect([...e.pieces!].sort()).toEqual(["Ik", "bel", "hem", "morgen", "op"].sort());
      expect(e.pieces!.join(" ")).not.toBe("Ik bel hem morgen op");
      expect(e.answer).toBe(text);
      expect(e.prompt.text).toBe("I call him tomorrow.");
      expect(checkAnswer(e, "ik bel hem morgen op").correct).toBe(true);
      expect(checkAnswer(e, e.pieces!.join(" ")).correct).toBe(false);
    }
  });

  it("needs 4-9 words", () => {
    const short = word("x", { sentences: [sentence("Ik bel hem.", "bel")] });
    const long = word("x", {
      sentences: [sentence("een twee drie vier vijf zes zeven acht negen tien.", "twee")],
    });
    expect(generate("scramble", short, pool, rng())).toBeNull();
    expect(generate("scramble", long, pool, rng())).toBeNull();
    expect(generate("scramble", word("x"), pool, rng())).toBeNull();
  });

  it("null for sentences made of one repeated word", () => {
    const rep = word("ja", { sentences: [sentence("ja ja ja ja", "ja")] });
    expect(generate("scramble", rep, pool, rng())).toBeNull();
  });
});

describe("dictation", () => {
  it("speaks a short sentence when available", () => {
    const w = word("hond", { sentences: [sentence("De hond slaapt in de mand.", "hond")] });
    const e = generate("dictation", w, [], rng())!;
    expect(e.skill).toBe("listening");
    expect(e.instruction).toBe("Type what you hear");
    expect(e.prompt.speak).toBe("De hond slaapt in de mand.");
    expect(e.answer).toBe("De hond slaapt in de mand.");
    expect(checkAnswer(e, "de hond slaapt in de mand").correct).toBe(true);
  });

  it("falls back to the lemma for long or missing sentences", () => {
    const long = word("hond", {
      glosses: ["dog"],
      sentences: [sentence("De hond slaapt de hele dag in de grote mand bij de deur.", "hond")],
    });
    const e = generate("dictation", long, [], rng())!;
    expect(e.prompt.speak).toBe("hond");
    expect(e.answer).toBe("hond");
    expect(e.prompt.hint).toBe("dog");
    expect(generate("dictation", word("kat"), [], rng())!.prompt.speak).toBe("kat");
  });
});

describe("all kinds", () => {
  it("set skill from SKILL_OF and are deterministic per seed", () => {
    const rich = word("lezen", {
      pos: "VERB",
      article: "de",
      forms: { participle: "gelezen", aux: "hebben", past: ["las", "lazen"] },
      sentences: [sentence("Ik lees elke dag een boek.", "lees")],
    });
    const kinds = Object.keys(SKILL_OF) as ExerciseKind[];
    for (const kind of kinds) {
      const a = generate(
        kind,
        rich,
        [rich, ...pool.map((p) => ({ ...p, pos: "VERB" }))],
        createRng(5),
      );
      const b = generate(
        kind,
        rich,
        [rich, ...pool.map((p) => ({ ...p, pos: "VERB" }))],
        createRng(5),
      );
      expect(a).toEqual(b);
      if (a) expect(a.skill).toBe(SKILL_OF[kind]);
    }
  });
});
