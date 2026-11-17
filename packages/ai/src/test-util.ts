import type { AnalyzedToken, LearnerModel } from "@app/core";
import type { AIProvider, ChatRequest, ChatResult } from "./types.js";

/** Scripted provider: returns the queued answers in order and records every request. */
export function fakeProvider(answers: (string | Error)[]): AIProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  const queue = [...answers];
  return {
    calls,
    config: { provider: "custom", baseUrl: "http://fake", model: "fake" },
    async chat(req: ChatRequest): Promise<ChatResult> {
      calls.push(req);
      const next = queue.shift();
      if (next === undefined) throw new Error("fake provider: no more answers");
      if (next instanceof Error) throw next;
      return { text: next, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

/** Whitespace tokenizer: lemma = lowercased word, no punctuation. */
export function fakeAnalyze(text: string): Promise<AnalyzedToken[]> {
  const out: AnalyzedToken[] = [];
  let i = 0;
  for (const m of text.matchAll(/\p{L}+/gu)) {
    out.push({
      i: i++,
      text: m[0],
      lemma: m[0].toLowerCase(),
      alt_lemmas: [],
      pos: "NOUN",
      morph: "",
      dep: "",
      head: 0,
      sent: 0,
      start: m.index,
      end: m.index + m[0].length,
      is_word: true,
      is_propn: false,
      is_num: false,
      particle_of: null,
      zipf: 4,
    });
  }
  return Promise.resolve(out);
}

export function modelOf(known: string[]): LearnerModel {
  return new Map(known.map((k) => [k, { state: "known" as const, pKnown: 1 }]));
}
