/**
 * The Sentence tab's picture of the sentence (F3, notes/wc6-sentence-structures.md): one row per
 * clause, a clause inside another on its own row under it and folded to […] where it sits. Each
 * part has a small label (first · verb · middle · verb end, or introducer · middle · verbs); the
 * two parts of a split verb are in the accent colour. Tap a row's label, a part or a word: one
 * line says why it's there. "Word types" puts the kind under every word.
 */
import type { AnalyzedToken } from "@app/core";
import { useMemo, useState } from "react";
import { readLocal, writeLocal } from "../../storage/local.js";
import {
  type Clause,
  type ClauseKind,
  type ClausePart,
  WORD_KIND,
  sentenceClauses,
  wordRole,
} from "./sentenceFrame.js";

type Field = ClausePart["field"];

const LABEL: Record<Field, string> = {
  link: "joins",
  words: "",
  first: "first",
  verb: "verb",
  middle: "middle",
  end: "verb end",
  rest: "after the end",
  intro: "starts it",
  verbs: "verbs",
};

const KIND: Record<ClauseKind, string> = {
  main: "Main clause",
  question: "Question",
  command: "Command",
  sub: "Clause inside",
  rel: "Says more about a word",
  phrase: "Phrase, no verb",
};

const KIND_WHY: Record<ClauseKind, string> = {
  main: "A main clause: the verb that changes with the person comes second.",
  question: "A question: the verb comes first, or right after the question word.",
  command: "A command: the verb comes first, and no one is named.",
  sub: "A clause inside the sentence. It starts with a word like omdat, als or dat, and its verbs go to the end.",
  rel: "It says more about the word before it. It starts with die, dat or waar…, and its verbs go to the end.",
  phrase: "A short phrase without a verb of its own. The clause inside it has one.",
};

const FIELD_WHY: Record<Field, string> = {
  link: "A joining word (en, maar, want, dus). It stands before the clause and takes no place: the verb still comes second after the first part.",
  words: "",
  first: "Anything can come first. The verb comes right after it.",
  verb: "The verb that changes with the person. In a main clause it always comes second.",
  middle: "Who and what: the rest of the clause sits here.",
  end: "The other verbs go to the end.",
  rest: "Words after the verb end: they come after the clause is complete.",
  intro: "This word starts the clause, and sends its verbs to the end.",
  verbs: "In a clause like this the verbs go to the end.",
};

const TYPES_KEY = "vuurtoren.sentence-word-types";

type Focus =
  | { kind: "clause"; clause: number }
  | { kind: "field"; clause: number; field: Field }
  | { kind: "word"; i: number }
  | null;

/** Main clauses in reading order, each followed by the clauses inside it (with their depth). */
function rows(clauses: readonly Clause[]): { k: number; depth: number }[] {
  const out: { k: number; depth: number }[] = [];
  const visit = (k: number, depth: number) => {
    out.push({ k, depth });
    clauses.forEach((c, j) => {
      if (c.parent === k) visit(j, depth + 1);
    });
  };
  clauses.forEach((c, k) => {
    if (c.parent === null) visit(k, 0);
  });
  return out;
}

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
  const clauses = useMemo(() => sentenceClauses(tokens, sent), [tokens, sent]);
  const [focus, setFocus] = useState<Focus>(null);
  const [types, setTypes] = useState(() => readLocal(TYPES_KEY) === "1");
  const word = (i: number) => {
    const t = tokens[i]!;
    return text.slice(t.start, t.end);
  };

  const wordButton = (i: number) => (
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
  );

  const why = (f: Focus): string => {
    if (!f) return clauses.length ? "Tap a part or a word to see why it's there." : "";
    if (f.kind === "word") {
      const t = tokens[f.i]!;
      return [word(f.i), WORD_KIND[t.pos], wordRole(t)].filter(Boolean).join(" · ");
    }
    const c = clauses[f.clause]!;
    if (f.kind === "clause") return KIND_WHY[c.kind];
    if (f.field === "end") {
      const particle = tokens.find((t) => t.particle_of === c.verb);
      if (particle)
        return `The rest of the verb goes to the end: ${word(c.verb)} … ${word(particle.i)} is one verb.`;
    }
    return FIELD_WHY[f.field];
  };

  if (!clauses.length) {
    // No conjugated verb: a short phrase. The words alone, so their kinds still show.
    const words = tokens.filter((t) => t.sent === sent && t.pos !== "PUNCT").map((t) => t.i);
    return (
      <section className="sframe" aria-label="The sentence, part by part">
        <p className="sframe-none">No verb: a short phrase.</p>
        <div className="sframe-line" lang="nl">
          <span className="sframe-part">
            <span className="sframe-words">{words.map(wordButton)}</span>
          </span>
        </div>
        <p className="sframe-why" aria-live="polite">
          {focus?.kind === "word" ? why(focus) : "Tap a word to see what kind of word it is."}
        </p>
        <TypesToggle types={types} setTypes={setTypes} />
      </section>
    );
  }

  return (
    <section className="sframe" aria-label="The sentence, part by part">
      {rows(clauses).map(({ k, depth }) => {
        const c = clauses[k]!;
        const particle = tokens.find((t) => t.particle_of === c.verb)?.i ?? null;
        return (
          <div
            key={k}
            className="sframe-row"
            data-kind={c.kind}
            style={depth ? { marginInlineStart: `${Math.min(depth, 3) * 16}px` } : undefined}
          >
            <button
              type="button"
              className="sframe-rowlabel"
              aria-pressed={focus?.kind === "clause" && focus.clause === k}
              onClick={() => setFocus({ kind: "clause", clause: k })}
            >
              {depth ? "└ " : ""}
              {KIND[c.kind]}
            </button>
            <div className="sframe-line" lang="nl">
              {c.parts
                .filter((p) => p.items.length)
                .map((p) => (
                  <span
                    key={p.field}
                    className="sframe-part"
                    data-field={p.field}
                    {...(p.field === "verb" ||
                    p.field === "verbs" ||
                    (p.field === "end" && particle !== null)
                      ? { "data-verb": "" }
                      : {})}
                  >
                    <span className="sframe-words">
                      {p.items.map((x) =>
                        typeof x === "number" ? (
                          wordButton(x)
                        ) : (
                          <span
                            key={`c${x.clause}`}
                            className="sframe-nested"
                            title={KIND[clauses[x.clause]!.kind]}
                          >
                            […]
                          </span>
                        ),
                      )}
                    </span>
                    {LABEL[p.field] ? (
                      <button
                        type="button"
                        className="sframe-label"
                        aria-pressed={
                          focus?.kind === "field" && focus.clause === k && focus.field === p.field
                        }
                        onClick={() => setFocus({ kind: "field", clause: k, field: p.field })}
                      >
                        {LABEL[p.field]}
                      </button>
                    ) : null}
                  </span>
                ))}
            </div>
          </div>
        );
      })}
      <p className="sframe-why" aria-live="polite">
        {why(focus)}
      </p>
      <TypesToggle types={types} setTypes={setTypes} />
    </section>
  );
}

function TypesToggle({ types, setTypes }: { types: boolean; setTypes: (on: boolean) => void }) {
  return (
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
  );
}
