/**
 * The word card's dictionary part (m5, WC2 step 2): the small forms table, the base verb of a
 * separable verb, words with the same meaning, the opposite and the separable family, from
 * dictionary v2 (`services.wordEntry`). Empty rows are left out: the card must look whole
 * without them (no opposite for 92% of the 5000). A tapped word opens its own card in the same
 * panel, with "← back" (`onOpen`, notes/wc2-word-card.md).
 */
import { useQuery } from "@tanstack/react-query";
import type { EntryResult, EntrySense, WordEntry as Entry } from "@app/nlp-client";
import { useContext, useEffect, useState } from "react";
import { ShellContext } from "../../shell/ShellContext.js";
import { useBackClose } from "../../shell/backStack.js";
import { useServices } from "../../services/context.js";

/** spaCy's part of speech → the dictionary's (Kaikki's). */
const KAIKKI_POS: Record<string, string> = {
  VERB: "verb",
  AUX: "verb",
  NOUN: "noun",
  ADJ: "adj",
  ADV: "adv",
  PROPN: "name",
};

type Row = [label: string, value: string];

const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** The forms to show: a short table, and the rest under "All forms". */
export function formRows(entry: Entry): { short: Row[]; more: Row[] } {
  const f = entry.forms ?? {};
  if (entry.pos === "verb") {
    const present = (f["present"] ?? {}) as Record<string, string>;
    const past = asList(f["past"]);
    const participle = asString(f["participle"]);
    const short: Row[] = [];
    if (present["ik"]) short.push(["ik", present["ik"]]);
    if (present["hij"]) short.push(["hij", present["hij"]]);
    if (past[0]) short.push(["past", past[0]]);
    // The perfect with its helper when the language server knows it (hij is gegaan, heeft gedaan).
    const aux = asString(f["aux"]);
    const helper = aux === "zijn" ? "is" : aux === "both" ? "heeft / is" : aux ? "heeft" : null;
    if (participle)
      short.push(helper ? ["perfect", `${helper} ${participle}`] : ["participle", participle]);
    const more: Row[] = [];
    if (present["jij"]) more.push(["jij", present["jij"]]);
    if (present["wij"]) more.push(["wij, jullie, zij", present["wij"]]);
    if (past[1]) more.push(["past, plural", past[1]]);
    return { short, more };
  }
  if (entry.pos === "noun") {
    const rows: Row[] = [];
    const plural = asString(f["plural"]);
    const dim = asString(f["diminutive"]);
    if (plural) rows.push(["plural", plural]);
    if (dim) rows.push(["small", dim]);
    return { short: rows, more: [] };
  }
  if (entry.pos === "adj") {
    const rows: Row[] = [];
    for (const [k, label] of [
      ["inflected", "with -e"],
      ["comparative", "more"],
      ["superlative", "most"],
    ] as const) {
      const v = asString(f[k]);
      if (v) rows.push([label, v]);
    }
    return { short: rows, more: [] };
  }
  return { short: [], more: [] };
}

/** Same meaning and opposite: the first sense that has them, else the entry's own. */
function related(entry: Entry): { same: string[]; opposite: string[] } {
  const senses = entry.extras?.senses ?? [];
  const pick = (k: "synonyms" | "antonyms") =>
    (senses.find((s) => s[k]?.length)?.[k] ?? entry.extras?.[k] ?? []).slice(0, 4);
  return { same: pick("synonyms"), opposite: pick("antonyms") };
}

/** The entry of the word's part of speech, else its first. */
export function entryFor(result: EntryResult | null | undefined, pos: string): Entry | null {
  if (!result?.entries.length) return null;
  const want = KAIKKI_POS[pos];
  return result.entries.find((e) => e.pos === want) ?? result.entries[0] ?? null;
}

export function WordEntry({
  lemma,
  pos,
  surface,
  onOpen,
}: {
  lemma: string;
  pos: string;
  surface: string;
  /** Open a word's own card in the same panel (its base verb, a family word …). */
  onOpen?: ((word: string) => void) | undefined;
}) {
  const services = useServices();
  const [all, setAll] = useState(false);
  const shell = useContext(ShellContext);
  const wide = !!shell?.inspectorWide;
  const setWide = shell?.setInspectorWide;
  // The card goes away (the panel closed, another word): the next one opens at the normal width.
  useEffect(() => () => setWide?.(false), [setWide]);
  // Esc and Android Back make the full entry smaller before anything else closes.
  useBackClose(wide, () => setWide?.(false));
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setWide?.(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [wide, setWide]);
  const q = useQuery({
    queryKey: ["word-entry", lemma, pos],
    queryFn: () => services.wordEntry?.(lemma, KAIKKI_POS[pos]) ?? null,
    enabled: !!services.wordEntry,
    staleTime: Infinity,
  });
  const entry = entryFor(q.data, pos);
  if (!entry) return null;
  const { short, more } = formRows(entry);
  const { same, opposite } = related(entry);
  const here = surface.toLowerCase();
  const table = all || wide ? [...short, ...more] : short;
  const lines: [string, string[]][] = [
    ["Level", entry.level ? [`about ${entry.level}`] : []],
    ["Base verb", entry.base ? [entry.base] : []],
    ["Same meaning", same],
    ["Opposite", opposite],
    ["Family", wide ? (entry.family ?? []) : (entry.family ?? []).slice(0, 8)],
    ...(wide ? ([["Related", entry.extras?.related ?? []]] as [string, string[]][]) : []),
  ];
  const senses: EntrySense[] = entry.extras?.senses ?? entry.glosses.map((gloss) => ({ gloss }));
  if (!table.length && lines.every(([, v]) => !v.length)) return null;
  return (
    <section
      className="word-entry"
      aria-label="Forms and related words"
      {...(wide ? { "data-wide": "" } : {})}
    >
      {setWide ? (
        <button
          type="button"
          className="k-link word-entry-full"
          aria-pressed={wide}
          onClick={() => setWide(!wide)}
        >
          {wide ? "Smaller ⤡" : "Full entry ⤢"}
        </button>
      ) : null}
      {wide ? (
        <ol className="word-entry-senses">
          {senses.map((s, k) => (
            <li key={k}>
              <span>{s.gloss}</span>
              {s.examples
                ? s.examples.map((ex, n) => (
                    <span key={n} className="word-entry-example">
                      <span lang="nl">{ex.nl}</span>
                      {ex.en ? <span> · {ex.en}</span> : null}
                    </span>
                  ))
                : null}
            </li>
          ))}
        </ol>
      ) : null}
      {table.length ? (
        <div className="word-entry-forms">
          <p className="k-overline">Forms</p>
          <dl>
            {table.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd {...(value.toLowerCase().includes(here) ? { "data-here": "" } : {})}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {more.length && !wide ? (
            <button type="button" className="k-link word-entry-all" onClick={() => setAll(!all)}>
              {all ? "Fewer forms" : "All forms"}
            </button>
          ) : null}
        </div>
      ) : null}
      {lines
        .filter(([, v]) => v.length)
        .map(([label, words]) => (
          <p key={label} className="word-entry-line">
            <span className="k-overline">{label}</span>{" "}
            {words.map((w, k) => (
              <span key={w}>
                {k ? ", " : null}
                {onOpen && !w.includes(" ") ? (
                  <button
                    type="button"
                    className="word-entry-word"
                    lang="nl"
                    onClick={() => onOpen(w)}
                  >
                    {w}
                  </button>
                ) : (
                  <span lang="nl">{w}</span>
                )}
              </span>
            ))}
          </p>
        ))}
    </section>
  );
}
