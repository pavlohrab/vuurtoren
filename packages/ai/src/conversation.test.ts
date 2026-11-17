import { describe, expect, it } from "vitest";
import {
  assistantHistoryMessage,
  buildSystemPrompt,
  parseTurn,
  runTurn,
  selectKnownLemmas,
} from "./conversation.js";
import { extractJson } from "./json.js";
import { explainSentence, simplifyText } from "./tasks.js";
import { fakeAnalyze, fakeProvider, modelOf } from "./test-util.js";

const setup = {
  topic: "koffie",
  vocabEstimate: 800,
  knownLemmas: ["ik", "drink", "koffie"],
  targetWords: ["gezellig"],
};
const model = modelOf(["ik", "drink", "koffie", "graag", "jij", "wat"]);
const out = (reply: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ reply, corrections: [], new_words: [], ...extra });

describe("json extraction and turn parsing", () => {
  it("handles fences and surrounding prose", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('text {"a":2} more')).toEqual({ a: 2 });
    expect(extractJson("no json")).toBeUndefined();
  });
  it("parses corrections (both key spellings) and drops malformed items", () => {
    const r = parseTurn(
      JSON.stringify({
        reply: "Hoi",
        corrections: [{ orig: "ik is", fixed: "ik ben", rule: "zijn" }, { bad: true }],
        new_words: [{ lemma: "gezellig", gloss: "cosy", example: "Het is gezellig." }, 3],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.turn.corrections).toEqual([
      { original: "ik is", corrected: "ik ben", explanation: "zijn" },
    ]);
    expect(r.turn.newWords).toHaveLength(1);
  });
  it("falls back to the raw text on invalid JSON", () => {
    const r = parseTurn("Hallo daar");
    expect(r.ok).toBe(false);
    expect(r.turn.reply).toBe("Hallo daar");
  });
});

describe("prompt", () => {
  it("contains vocabulary, targets, JSON contract and stays static", () => {
    const p = buildSystemPrompt(setup);
    expect(p.cached).toContain("koffie");
    expect(p.cached).toContain("gezellig");
    expect(p.cached).toContain('"new_words"');
    expect(buildSystemPrompt(setup)).toEqual(p);
  });
  it("selects at most max lemmas, topic words first, learning words included", () => {
    const words = Array.from({ length: 1000 }, (_, i) => ({
      key: `w${i}`,
      state: i % 10 === 0 ? "learning" : "known",
      pKnown: 0.9,
    }));
    words.push({ key: "koffie", state: "known", pKnown: 1 });
    const sel = selectKnownLemmas(words, "over koffie", 300);
    expect(sel.length).toBeLessThanOrEqual(300);
    expect(sel[0]).toBe("koffie");
    expect(sel).toContain("w0");
    expect(new Set(sel).size).toBe(sel.length);
  });
});

describe("runTurn", () => {
  it("accepts a reply with enough coverage: one call, no rewrite", async () => {
    const p = fakeProvider([out("Ik drink koffie")]);
    const r = await runTurn({ provider: p, analyze: fakeAnalyze, model }, setup, [], "hoi");
    expect(p.calls).toHaveLength(1);
    expect(r.rewritten).toBe(false);
    expect(r.coverage).toBe(1);
    expect(p.calls[0]!.json).toBe(true);
  });

  it("treats declared new words and target words as allowed", async () => {
    const p = fakeProvider([out("Ik drink koffie gezellig", { new_words: [] })]);
    const r = await runTurn({ provider: p, analyze: fakeAnalyze, model }, setup, [], "hoi");
    expect(r.unknown).toEqual([]);
    expect(r.rewritten).toBe(false);
  });

  it("requests exactly ONE rewrite naming the offending words and uses it", async () => {
    const p = fakeProvider([out("Ik drink koffie zonnebloem"), out("Ik drink koffie")]);
    const r = await runTurn({ provider: p, analyze: fakeAnalyze, model }, setup, [], "hoi");
    expect(p.calls).toHaveLength(2);
    const last = p.calls[1]!.messages.at(-1)!;
    expect(last.content).toContain("zonnebloem");
    expect(r.rewritten).toBe(true);
    expect(r.turn.reply).toBe("Ik drink koffie");
    expect(r.coverage).toBe(1);
  });

  it("does not loop: a failed rewrite is kept at one, leftovers are glossed", async () => {
    const p = fakeProvider([out("Ik drink zonnebloem"), out("Ik drink zonnebloem nog")]);
    const r = await runTurn(
      {
        provider: p,
        analyze: fakeAnalyze,
        model,
        glossFor: (l) => Promise.resolve(Object.fromEntries(l.map((x) => [x, `gloss:${x}`]))),
      },
      setup,
      [],
      "hoi",
    );
    expect(p.calls).toHaveLength(2);
    expect(r.unknown).toContain("zonnebloem");
    expect(r.glosses["zonnebloem"]).toBe("gloss:zonnebloem");
  });

  it("survives invalid JSON (raw text shown, no rewrite) and a down NLP server", async () => {
    const p = fakeProvider(["gewoon tekst"]);
    const r = await runTurn(
      { provider: p, analyze: () => Promise.reject(new Error("down")), model },
      setup,
      [],
      "hoi",
    );
    expect(r.parseFailed).toBe(true);
    expect(r.turn.reply).toBe("gewoon tekst");
    expect(r.coverage).toBeNull();
    expect(p.calls).toHaveLength(1);
  });

  it("ignores an unparseable rewrite and keeps the original; sums usage", async () => {
    const p = fakeProvider([out("Ik drink zonnebloem"), "kapot"]);
    const r = await runTurn({ provider: p, analyze: fakeAnalyze, model }, setup, [], "x");
    expect(r.turn.reply).toBe("Ik drink zonnebloem");
    expect(r.usage.inputTokens).toBe(20);
  });

  it("opens the conversation when the user text is empty and replays JSON history", async () => {
    const p = fakeProvider([out("Ik drink koffie")]);
    const hist = [assistantHistoryMessage({ reply: "Hoi", corrections: [], newWords: [] })];
    await runTurn({ provider: p, analyze: fakeAnalyze, model }, setup, hist, "");
    expect(p.calls[0]!.messages.at(-1)!.content).toContain("Start the conversation");
    expect(hist[0]!.content).toContain('"reply"');
  });
});

describe("reader helpers", () => {
  it("explainSentence sends the sentence", async () => {
    const p = fakeProvider(["  Meaning. "]);
    expect(await explainSentence(p, "Ik bel je op.")).toBe("Meaning.");
    expect(p.calls[0]!.messages[0]!.content).toBe("Ik bel je op.");
  });
  it("explainSentence passes detected grammar as context", async () => {
    const p = fakeProvider(["Meaning."]);
    await explainSentence(p, "Morgen ga ik.", {
      vocabEstimate: 900,
      grammar: [{ title: "Inversion", note: "«Morgen» comes first." }],
    });
    const msg = p.calls[0]!.messages[0]!.content;
    expect(msg.startsWith("Morgen ga ik.")).toBe(true);
    expect(msg).toContain("- Inversion: «Morgen» comes first.");
    expect(p.calls[0]!.system).toContain("cover those points first");
  });
  it("simplifyText names offending words and re-scores", async () => {
    const p = fakeProvider(["Ik drink koffie"]);
    const r = await simplifyText(
      { provider: p, analyze: fakeAnalyze, model, vocabEstimate: 800, targetCoverage: 0.95 },
      "Ik drink koffie zonnebloem",
    );
    expect(p.calls[0]!.messages[0]!.content).toContain("zonnebloem");
    expect(r.before).toBeLessThan(1);
    expect(r.after).toBe(1);
  });
});
