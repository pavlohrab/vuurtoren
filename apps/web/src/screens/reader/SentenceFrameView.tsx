/**
 * The Sentence tab's picture of the sentence (take 3, notes/wc2-word-card.md §5): the sentence on
 * one line, a small label under each part (first · verb · middle · verb end), the two parts of a
 * split verb in the accent colour. Tap a part: one line says why it's there. Tap a word: its kind
 * and what it does. "Word types" puts the kind under every word.
 */
import type { AnalyzedToken } from "@app/core";
import { useMemo, useState } from "react";
import { readLocal, writeLocal } from "../../storage/local.js";
import { type Field, WORD_KIND, sentenceFrame, wordRole } from "./sentenceFrame.js";

const LABEL: Record<Field, string> = {
  first: "first",
  verb: "verb",
  middle: "middle",
  end: "verb end",
  rest: "rest",
};

const TYPES_KEY = "vuurtoren.sentence-word-types";

type Focus = { kind: "field"; field: Field } | { kind: "word"; i: number } | null;

export function SentenceFrameView({
  tokens,
  sent,
  text,
}: {
  tokens: readonly AnalyzedToken[];
  sent: number;
  /** The text's content (words are slices of it). */
  text: string;
}) {
  const frame = useMemo(() => sentenceFrame(tokens, sent), [tokens, sent]);
  const [focus, setFocus] = useState<Focus>(null);
  const [types, setTypes] = useState(() => readLocal(TYPES_KEY) === "1");
  const word = (i: number) => {
    const t = tokens[i]!;
    return text.slice(t.start, t.end);
  };
  const parts = frame?.parts ??
    // No frame (a fragment): the words alone, so the kinds can still be shown.
    [
      {
        field: null,
        tokens: tokens.filter((t) => t.sent === sent && t.pos !== "PUNCT").map((t) => t.i),
      },
    ];

  const why = (field: Field): string => {
    if (!frame) return "";
    if (field === "first") return "Anything can come first. The verb comes right after it.";
    if (field === "verb")
      return "The verb that changes with the person. In a main sentence it always comes second.";
    if (field === "middle") return "Who and what: the rest of the sentence sits here.";
    if (field === "end") {
      const p = frame.particle;
      return p !== null
        ? `The rest of the verb goes to the end: ${word(frame.verb)} … ${word(p)} is one verb.`
        : "The other verbs go to the end.";
    }
    return "A sentence of its own inside this one.";
  };
  const line =
    focus?.kind === "field"
      ? why(focus.field)
      : focus?.kind === "word"
        ? [word(focus.i), WORD_KIND[tokens[focus.i]!.pos], wordRole(tokens[focus.i]!)]
            .filter(Boolean)
            .join(" · ")
        : frame
          ? "Tap a part or a word to see why it's there."
          : "Tap a word to see what kind of word it is.";

  return (
    <section className="sframe" aria-label="The sentence, part by part">
      <div className="sframe-line" lang="nl">
        {parts.map((p, k) => (
          <span
            key={k}
            className="sframe-part"
            {...(p.field ? { "data-field": p.field } : {})}
            {...(frame && (p.field === "verb" || (p.field === "end" && frame.particle !== null))
              ? { "data-verb": "" }
              : {})}
          >
            <span className="sframe-words">
              {p.tokens.map((i) => (
                <button
                  key={i}
                  type="button"
                  className="sframe-word"
                  aria-pressed={focus?.kind === "word" && focus.i === i}
                  onClick={() => setFocus({ kind: "word", i })}
                >
                  {word(i)}
                  {types && WORD_KIND[tokens[i]!.pos] ? (
                    <small className="sframe-kind">{WORD_KIND[tokens[i]!.pos]}</small>
                  ) : null}
                </button>
              ))}
            </span>
            {p.field ? (
              <button
                type="button"
                className="sframe-label"
                aria-pressed={focus?.kind === "field" && focus.field === p.field}
                onClick={() => setFocus({ kind: "field", field: p.field as Field })}
              >
                {LABEL[p.field as Field]}
              </button>
            ) : null}
          </span>
        ))}
      </div>
      <p className="sframe-why" aria-live="polite">
        {line}
      </p>
      <label className="sframe-types">
        <input
          type="checkbox"
          checked={types}
          onChange={(e) => {
            setTypes(e.target.checked);
            writeLocal(TYPES_KEY, e.target.checked ? "1" : null);
          }}
        />
        Word types
      </label>
    </section>
  );
}
