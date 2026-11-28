/**
 * Practice, step 6 "Use it": the learner writes a Dutch sentence with a word, and the AI says if
 * it is right (algorithms.md 4.7). It judges the sentence; which word is which is not its job.
 */
import { extractJson } from "./json.js";
import type { AIProvider } from "./types.js";

export interface UseCheck {
  /** "right": correct Dutch with the word used well; "almost": the word is right, something else
   * isn't; "wrong": the word is missing or used wrongly. */
  verdict: "right" | "almost" | "wrong";
  /** The sentence put right, when it wasn't. */
  better?: string;
  /** One short line on what was wrong, in English. */
  why?: string;
  /** The grammar point of the main mistake, when it is one of Practice's (choose.ts). */
  point?: (typeof POINTS)[number];
  /** Words of the sentence that were used wrong, as written. */
  wrong?: string[];
}

/** Practice's grammar points (choose.ts `GrammarPoint`). */
const POINTS = [
  "word-order",
  "gender",
  "adjective-e",
  "perfect",
  "separable",
  "verb-form",
] as const;

const SYSTEM = `You check one Dutch sentence written by a learner of Dutch.
They were asked to use one word in a sentence of their own.
Answer with JSON only: {"verdict": "right" | "almost" | "wrong", "better": "...", "why": "..."}.
- "right": the sentence is correct Dutch and uses the word with a fitting meaning. Leave out "better" and "why".
- "almost": the word is used well, but something else is wrong (word order, a form, de or het, spelling).
- "wrong": the word is missing, or used with the wrong meaning or form.
For "almost" and "wrong", "better" is the learner's sentence put right with as few changes as you can, and "why" is one short line in plain English on the main mistake, for example "The verb goes second." Small spelling slips and a missing full stop are fine: still "right".
When the main mistake is one of these, add "point" with its name: "word-order", "gender" (de or het), "adjective-e" (the -e on an adjective), "perfect" (heeft/is with a participle), "separable" (a separable verb), "verb-form". Add "wrong": the words of the learner's sentence that were used wrong, exactly as they wrote them (leave it out when there are none).`;

export async function checkUse(
  provider: AIProvider,
  ask: { word: string; meaning?: string; sentence: string },
): Promise<UseCheck> {
  const res = await provider.chat({
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Word: ${ask.word}${ask.meaning ? ` (${ask.meaning})` : ""}\nSentence: ${ask.sentence}`,
      },
    ],
    json: true,
    maxTokens: 300,
  });
  const j = extractJson(res.text);
  const v = j?.["verdict"];
  if (v !== "right" && v !== "almost" && v !== "wrong")
    throw new Error("The AI's answer could not be read. Try again.");
  const out: UseCheck = { verdict: v };
  if (v !== "right" && typeof j?.["better"] === "string") out.better = j["better"];
  if (v !== "right" && typeof j?.["why"] === "string") out.why = j["why"];
  const point = j?.["point"];
  if (v !== "right" && typeof point === "string" && (POINTS as readonly string[]).includes(point))
    out.point = point as (typeof POINTS)[number];
  const wrong = j?.["wrong"];
  if (Array.isArray(wrong)) {
    const words = wrong.filter((w): w is string => typeof w === "string" && w.trim() !== "");
    if (words.length) out.wrong = words;
  }
  return out;
}
