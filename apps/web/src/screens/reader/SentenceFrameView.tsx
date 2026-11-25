/**
 * The Sentence tab's picture of the sentence (F3, notes/wc6-sentence-structures.md): one row per
 * clause, a clause inside another on its own row under it and folded to […] where it sits. Each
 * part has a small label (first · verb · middle · verb end, or introducer · middle · verbs); the
 * two parts of a split verb are in the accent colour. Tap a row's label, a part or a word: one
 * line says why it's there. "Word types" puts the kind under every word.
 */
import type { AnalyzedToken } from "@app/core";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { readLocal, writeLocal } from "../../storage/local.js";
import {
  type Clause,
  type ClauseKind,
  type ClausePart,
  WORD_KIND,
  frameTokens,
  sentenceClauses,
  structureDoubtful,
  wordRole,
} from "./sentenceFrame.js";
import type { PickHandlers } from "./SentenceTab.js";

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
/** Test build (F3): how a clause about a word shows that word. B "under" = the row starts under
 * the word; A "name" = the row names it. Pavlo picks one, then the other goes. */
const LINKS_KEY = "vuurtoren.sentence-links";
type LinkStyle = "under" | "name";

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
  tokens: given,
  sent,
  text,
  marked,
  bindWord,
}: {
  tokens: readonly AnalyzedToken[];
  sent: number;
  /** The text's content (words are slices of it). */
  text: string;
  /** Words lit up in the Sentence tab, with their colour (1–9). */
  marked?: ReadonlyMap<number, number>;
  /** Tap, Ctrl-click and long press on a word, shared with the sentence above. */
  bindWord?: (i: number) => PickHandlers;
}) {
  // SyntaxDot's parse where the server had it (the words and offsets are the same).
  const tokens = useMemo(() => frameTokens(given), [given]);
  const clauses = useMemo(() => sentenceClauses(tokens, sent), [tokens, sent]);
  const doubtful = useMemo(() => structureDoubtful(tokens, sent, clauses), [tokens, sent, clauses]);
  const [focus, setFocus] = useState<Focus>(null);
  const [types, setTypes] = useState(() => readLocal(TYPES_KEY) === "1");
  const [links, setLinks] = useState<LinkStyle>(() =>
    readLocal(LINKS_KEY) === "name" ? "name" : "under",
  );
  // Clauses inside others, numbered in reading order when there are two or more.
  const order = useMemo(() => rows(clauses), [clauses]);
  const number = useMemo(() => {
    const inner = order.filter(({ depth }) => depth > 0).map(({ k }) => k);
    return new Map(inner.length >= 2 ? inner.map((k, n) => [k, n + 1]) : []);
  }, [order]);
  // Style B: where each "about" row starts (under its word in the rows above), measured.
  const rowsRef = useRef<HTMLDivElement>(null);
  const [under, setUnder] = useState<Map<number, number>>(new Map());
  useLayoutEffect(() => {
    const box = rowsRef.current;
    if (!box || links !== "under") return;
    const measure = () => {
      const left = box.getBoundingClientRect().left;
      const next = new Map<number, number>();
      clauses.forEach((c, k) => {
        if (c.about == null) return;
        const el = box.querySelector<HTMLElement>(`[data-i="${c.about}"]`);
        if (el) next.set(k, Math.max(0, el.getBoundingClientRect().left - left));
      });
      setUnder((old) =>
        [...next].every(([k, v]) => old.get(k) === v) && old.size === next.size ? old : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [clauses, links, types]);
  const word = (i: number) => {
    const t = tokens[i]!;
    return text.slice(t.start, t.end);
  };

  const wordButton = (i: number) => {
    const bound = bindWord?.(i);
    const c = marked?.get(i);
    return (
      <button
        key={i}
        type="button"
        className="sframe-word k-sbs-w"
        data-i={i}
        {...(focus?.kind === "clause" && clauses[focus.clause]?.about === i
          ? { "data-about": "" }
          : {})}
        {...(c ? { "data-pc": c } : {})}
        aria-pressed={focus?.kind === "word" && focus.i === i}
        {...bound}
        onClick={(e) => {
          setFocus({ kind: "word", i });
          bound?.onClick(e);
        }}
      >
        {word(i)}
        {types && WORD_KIND[tokens[i]!.pos] ? (
          <small className="sframe-kind">{WORD_KIND[tokens[i]!.pos]}</small>
        ) : null}
      </button>
    );
  };

  /** A link part that isn't a joining word ("Nee,", "Gelukkig,"): labelled "aside". */
  const aside = (p: ClausePart) =>
    p.items.length === 1 &&
    typeof p.items[0] === "number" &&
    !["en", "maar", "want", "dus", "of"].includes(tokens[p.items[0]]!.text.toLowerCase());
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
    if (f.field === "link" && aside(c.parts.find((p) => p.field === "link")!))
      return "A word on its own before the clause (ja, nee, hé). It takes no place: the verb still comes second.";
    return FIELD_WHY[f.field];
  };

  if (!clauses.length) {
    // No conjugated verb: a short phrase. The words alone, so their kinds still show.
    const words = tokens.filter((t) => t.sent === sent && t.pos !== "PUNCT").map((t) => t.i);
    return (
      <section className="sframe k-pairs" aria-label="The sentence, part by part">
        <p className="sframe-none">No verb: a short phrase.</p>
        {doubtful ? <Doubt /> : null}
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
    <section className="sframe k-pairs" aria-label="The sentence, part by part">
      {/* Each clause on one line; a long one scrolls the rows sideways together. */}
      <div className="sframe-scroll">
        <div className="sframe-rows" ref={rowsRef}>
          {order.map(({ k, depth }) => {
            const c = clauses[k]!;
            const about = c.about == null ? null : word(c.about);
            const n = number.get(k);
            const x = links === "under" ? under.get(k) : undefined;
            const particle = tokens.find((t) => t.particle_of === c.verb)?.i ?? null;
            return (
              <div
                key={k}
                className="sframe-row"
                data-kind={c.kind}
                style={
                  x !== undefined
                    ? { marginInlineStart: `${x}px` }
                    : depth
                      ? { marginInlineStart: `${Math.min(depth, 3) * 16}px` }
                      : undefined
                }
              >
                <button
                  type="button"
                  className="sframe-rowlabel"
                  aria-pressed={focus?.kind === "clause" && focus.clause === k}
                  onClick={() => setFocus({ kind: "clause", clause: k })}
                >
                  {depth ? "└ " : ""}
                  {n ? `${n} · ` : ""}
                  {about ? `About “${about}”` : KIND[c.kind]}
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
                                {number.get(x.clause) ? <sup>{number.get(x.clause)}</sup> : null}
                              </span>
                            ),
                          )}
                        </span>
                        {(p.field === "link" && aside(p) ? "aside" : LABEL[p.field]) ? (
                          <button
                            type="button"
                            className="sframe-label"
                            aria-pressed={
                              focus?.kind === "field" &&
                              focus.clause === k &&
                              focus.field === p.field
                            }
                            onClick={() => setFocus({ kind: "field", clause: k, field: p.field })}
                          >
                            {p.field === "link" && aside(p) ? "aside" : LABEL[p.field]}
                          </button>
                        ) : null}
                      </span>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {doubtful ? <Doubt /> : null}
      <p className="sframe-why" aria-live="polite">
        {why(focus)}
      </p>
      <TypesToggle types={types} setTypes={setTypes} />
      {clauses.some((c) => c.about != null) ? (
        <div className="sframe-links" role="radiogroup" aria-label="The word a clause is about">
          {(["under", "name"] as const).map((v) => (
            <label key={v}>
              <input
                type="radio"
                name="sframe-links"
                checked={links === v}
                onChange={() => {
                  setLinks(v);
                  writeLocal(LINKS_KEY, v === "name" ? "name" : null);
                }}
              />
              {v === "under" ? "Under the word (B)" : "By name (A)"}
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** The parse looks unsure (structureDoubtful): said once, quietly. */
function Doubt() {
  return <p className="sframe-doubt">This is a low-confidence sentence structure.</p>;
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
