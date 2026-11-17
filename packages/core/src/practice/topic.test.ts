import { describe, expect, it } from "vitest";
import { countHits, hitsAtToken, hitsInSentence, spotlightTokens } from "../reading/grammar.js";
import type { GrammarHit } from "../reading/grammar.js";
import { createRng } from "./rng.js";
import { sentence, word } from "./testutil.js";
import { buildTopicSession, sentencesWithHits, type TopicSentence } from "./topic.js";

const topicSentence = (text: string, mark: string, key = mark): TopicSentence => {
  const at = text.indexOf(mark);
  return { text, marks: [[at, at + mark.length]], source: "text", key, note: `note: ${text}` };
};

describe("sentencesWithHits", () => {
  it("keeps only hit sentences (ignoring case and spacing)", () => {
    const s = [
      sentence("Ik bel mijn moeder op.", "bel"),
      sentence("Ik wil haar opbellen.", "opbellen"),
    ];
    expect(sentencesWithHits(s, ["ik bel  mijn moeder op."]).map((x) => x.text)).toEqual([
      "Ik bel mijn moeder op.",
    ]);
    expect(sentencesWithHits(s, [])).toEqual([]);
  });
});

describe("buildTopicSession", () => {
  it("scrambles hit sentences and explains them with the detector's note", () => {
    const sentences = [
      topicSentence("Morgen ga ik naar school.", "ga"),
      topicSentence("Gisteren kocht hij een nieuwe fiets.", "kocht"),
    ];
    const out = buildTopicSession({ kinds: ["scramble"], sentences, words: [] }, createRng(1));
    expect(out.map((e) => e.kind)).toEqual(["scramble", "scramble"]);
    expect(out.map((e) => e.answer).sort()).toEqual(sentences.map((s) => s.text).sort());
    for (const e of out) expect(e.explanation).toBe(`note: ${e.answer}`);
  });

  it("builds word exercises only on sentences where the topic was detected", () => {
    const opbellen = word("opbellen", {
      pos: "VERB",
      forms: { separable: { particle: "op", stem: "bellen" } },
      sentences: [
        // Not a hit sentence for the topic (say the detector did not fire here): must not be used.
        sentence("Ik bel mijn zus vanavond op.", "bel"),
        sentence("Wij bellen de dokter morgen op.", "bellen"),
      ],
    });
    const hit = topicSentence("Wij bellen de dokter morgen op.", "bellen", "opbellen");
    const out = buildTopicSession(
      { kinds: ["separable"], sentences: [hit], words: [opbellen] },
      createRng(7),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("separable");
    expect(out[0]?.answer).toBe("Wij bellen de dokter morgen op.");

    // Without a hit sentence the separable generator has nothing to work with.
    const none = buildTopicSession(
      { kinds: ["separable"], sentences: [], words: [opbellen] },
      createRng(7),
    );
    expect(none).toEqual([]);
  });

  it("mixes word and sentence exercises, caps the size and skips repeats", () => {
    const nouns = ["huisje", "boekje", "kopje"].map((l) =>
      word(l, { article: "het", sentences: [] }),
    );
    const sentences = [
      topicSentence("Het meisje heeft een hondje.", "hondje"),
      topicSentence("Het meisje heeft een hondje.", "meisje"),
      topicSentence("Ik wil een koekje en een kopje thee.", "kopje"),
    ];
    const out = buildTopicSession(
      { kinds: ["gender", "scramble"], sentences, words: nouns, size: 4 },
      createRng(3),
    );
    expect(out).toHaveLength(4);
    expect(out.filter((e) => e.kind === "gender").length).toBeGreaterThanOrEqual(2);
    const scrambles = out.filter((e) => e.kind === "scramble").map((e) => e.answer);
    expect(new Set(scrambles).size).toBe(scrambles.length);
    expect(out.map((e) => e.kind)[0]).toBe("gender");
    expect(out.map((e) => e.kind)[1]).toBe("scramble");
  });
});

describe("grammar hit helpers", () => {
  const hits: GrammarHit[] = [
    { topic: "inversion", tokens: [1, 2], sent: 0, start: 0, end: 25, note: "a" },
    { topic: "separable-verbs", tokens: [1, 6], sent: 0, start: 0, end: 25, note: "b" },
    { topic: "negation", tokens: [12], sent: 1, start: 26, end: 40, note: "c" },
  ];
  it("maps tokens to topics", () => {
    const m = spotlightTokens(hits);
    expect(m.get(1)).toEqual(["inversion", "separable-verbs"]);
    expect(m.get(12)).toEqual(["negation"]);
    expect(spotlightTokens(hits, new Set(["negation"])).has(1)).toBe(false);
  });
  it("finds hits by token and sentence, and counts them", () => {
    expect(hitsAtToken(hits, 6).map((h) => h.topic)).toEqual(["separable-verbs"]);
    expect(hitsInSentence(hits, 0)).toHaveLength(2);
    expect(countHits(hits)).toEqual({ inversion: 1, "separable-verbs": 1, negation: 1 });
  });
});
