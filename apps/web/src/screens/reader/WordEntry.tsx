/**
 * The word card's dictionary parts (F2, mock round 2 iteration 1, `notes/f2-word-card.md`), from
 * dictionary v2 (`services.wordEntry`): the forms table beside the head, the meaning lines, the
 * related words as chips, the card's extra actions (Full entry, level) and the full
 * entry. Rows that have nothing aren't there: the card must look whole without them. A tapped
 * word opens its own card in the same panel, with "← back" (`onOpen`, notes/wc2-word-card.md).
 */
import { useQuery } from "@tanstack/react-query";
import type { InspectorEntry } from "@app/core";
import type { EntryResult, EntrySense, WordEntry as Entry } from "@app/nlp-client";
import { useState } from "react";
import { useServices } from "../../services/context.js";
import { sameMeaning } from "../../services/liveDictionary.js";

/** spaCy's part of speech → the dictionary's (Kaikki's). */
const KAIKKI_POS: Record<string, string> = {
  VERB: "verb",
  AUX: "verb",
  NOUN: "noun",
  ADJ: "adj",
  ADV: "adv",
  PROPN: "name",
};

/** A form row: its label, the form, and what it is in one line (said when it's tapped). */
type Row = { label: string; form: string; what: string };

const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** "is" / "heeft" for the perfect, when it's known. */
function helperOf(f: Record<string, unknown>): string | null {
  // aux_best: decided when the pack was built (Wiktionary, curated lists, Tatoeba); aux_nl: the
  // Dutch Wiktionary's alone, in packs built without the sentences.
  const aux = asString(f["aux"]) ?? asString(f["aux_best"]) ?? asString(f["aux_nl"]);
  return aux === "zijn" ? "is" : aux === "both" ? "heeft / is" : aux ? "heeft" : null;
}

/** The forms in a fixed order: the first four on the card, all of them under "All forms". */
function formRows(entry: Entry): { short: Row[]; all: Row[] } {
  const f = entry.forms ?? {};
  if (entry.pos === "verb") {
    const present = (f["present"] ?? {}) as Record<string, string>;
    const past = asList(f["past"]);
    const participle = asString(f["participle"]);
    const helper = helperOf(f);
    const sep = (f["separable"] ?? null) as { particle?: string } | null;
    const perfect: Row | null = participle
      ? helper
        ? { label: "perfect", form: `${helper} ${participle}`, what: "perfect" }
        : { label: "participle", form: participle, what: "past participle" }
      : null;
    const ik = present["ik"];
    const hij = present["hij"];
    const short: Row[] = [
      ik ? { label: "ik", form: ik, what: "present, ik" } : null,
      hij ? { label: "hij", form: hij, what: "present, hij/zij/het" } : null,
      past[0] ? { label: "past", form: past[0], what: "past, ik/hij/zij" } : null,
      perfect,
    ].filter((r): r is Row => r !== null);
    const jij = present["jij"];
    // A separable verb joins up in a subordinate clause: "… omdat ze de deur opendoet".
    const joined =
      sep?.particle && hij && hij.endsWith(` ${sep.particle}`)
        ? `… ${sep.particle}${hij.slice(0, -sep.particle.length - 1)}`
        : null;
    const all: Row[] = [
      ik ? { label: "ik", form: ik, what: "present, ik" } : null,
      jij && jij !== hij ? { label: "jij", form: jij, what: "present, jij" } : null,
      hij
        ? {
            label: jij === hij ? "jij, hij, zij, het" : "hij, zij, het",
            form: hij,
            what: "present, singular",
          }
        : null,
      present["wij"]
        ? { label: "wij, jullie, zij", form: present["wij"], what: "present, plural" }
        : null,
      past[0] ? { label: "past", form: past[0], what: "past, singular" } : null,
      past[1] ? { label: "past, plural", form: past[1], what: "past, plural" } : null,
      perfect,
      joined
        ? { label: "in a joined clause", form: joined, what: "in a subordinate clause" }
        : null,
      ik ? { label: "command", form: `${ik}!`, what: "command" } : null,
    ].filter((r): r is Row => r !== null);
    return { short, all };
  }
  if (entry.pos === "noun") {
    const rows: Row[] = [];
    const plural = asString(f["plural"]);
    const dim = asString(f["diminutive"]);
    if (plural) rows.push({ label: "plural", form: plural, what: "plural" });
    if (dim) rows.push({ label: "small", form: dim, what: "small (diminutive)" });
    return { short: rows, all: rows };
  }
  if (entry.pos === "adj") {
    const rows: Row[] = [];
    for (const [k, label, what] of [
      ["inflected", "with -e", "with -e (de grote man)"],
      ["comparative", "more", "comparative"],
      ["superlative", "most", "superlative"],
    ] as const) {
      const v = asString(f[k]);
      if (v) rows.push({ label, form: v, what });
    }
    return { short: rows, all: rows };
  }
  return { short: [], all: [] };
}

/** Same meaning and opposite: the first everyday sense that has them, else the entry's own. */
function related(entry: Entry): { same: string[]; opposite: string[] } {
  // Not an old or specialist sense: "kleine burgemeester" is the gull's synonym, not the mayor's.
  const senses = (entry.extras?.senses ?? []).filter((s) => !s.mark);
  const pick = (k: "synonyms" | "antonyms") =>
    (senses.find((s) => s[k]?.length)?.[k] ?? entry.extras?.[k] ?? []).slice(0, 4);
  return { same: pick("synonyms"), opposite: pick("antonyms") };
}

/** The entry of the word's part of speech, else its first. */
function entryFor(result: EntryResult | null | undefined, pos: string): Entry | null {
  if (!result?.entries.length) return null;
  const want = KAIKKI_POS[pos];
  return result.entries.find((e) => e.pos === want) ?? result.entries[0] ?? null;
}

/** The dictionary entry of a word (one request per word, shared by the card's parts). */
export function useWordEntry(lemma: string | null | undefined, pos: string): Entry | null {
  const services = useServices();
  const q = useQuery({
    queryKey: ["word-entry", lemma, pos],
    queryFn: () => services.wordEntry?.(lemma!, KAIKKI_POS[pos]) ?? null,
    enabled: !!services.wordEntry && !!lemma,
    staleTime: Infinity,
  });
  return entryFor(q.data, pos);
}

/**
 * The forms table (beside the head on a computer, under it on a phone): shaded rows, the page's
 * own form marked. A tapped form is said and explained in one line under the table; nothing else
 * moves. "All forms" opens the rest in place.
 */
export function CardForms({
  entry,
  surface,
  onSay,
  all: showAll = false,
}: {
  entry: Entry;
  surface: string;
  onSay?: ((text: string) => void) | undefined;
  /** Every form, no toggle (the full entry). */
  all?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tapped, setTapped] = useState<Row | null>(null);
  const { short, all } = formRows(entry);
  const rows = showAll || open ? all : short;
  if (!rows.length) return null;
  const here = surface.toLowerCase();
  return (
    <div className="card-forms">
      <table>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              {...(r.form.toLowerCase().includes(here) ? { "data-here": "" } : {})}
              {...(tapped?.label === r.label ? { "data-tapped": "" } : {})}
            >
              <th scope="row">{r.label}</th>
              <td>
                <button
                  type="button"
                  lang="nl"
                  onClick={() => {
                    setTapped(r);
                    onSay?.(r.form.replace(/^… /, "").replace(/!$/, ""));
                  }}
                >
                  {r.form}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tapped ? (
        <p className="card-forms-said" role="status">
          ▶ <span lang="nl">{tapped.form}</span> · {tapped.what}
        </p>
      ) : null}
      {!showAll && all.length > short.length ? (
        <button type="button" className="k-link card-forms-all" onClick={() => setOpen(!open)}>
          {open ? "Fewer forms" : "All forms"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The meaning: one line when the sentence's meaning is the dictionary's; when they differ, both
 * ("Here: for a moment" and "Dictionary: equal, even; just").
 */
export function CardMeaning({ word }: { word: InspectorEntry }) {
  const dictionary = word.glosses[0] ?? null;
  const here =
    word.sentenceGloss ??
    (word.glossNote === "in this sentence" ? (word.glosses[0] ?? null) : null);
  if (here && dictionary && !sameMeaning(here, dictionary)) {
    const other = word.glosses.find((g) => !sameMeaning(g, here)) ?? dictionary;
    return (
      <dl className="card-meaning" data-two="">
        <div>
          <dt>Here</dt>
          <dd>{here}</dd>
        </div>
        <div>
          <dt>Dictionary</dt>
          <dd>{other}</dd>
        </div>
      </dl>
    );
  }
  const one = dictionary ?? here;
  return (
    <p className="card-meaning">
      {one ?? <span className="card-meaning-none">No meaning yet</span>}
      {one && word.glossNote && word.glossNote !== "in this sentence" ? (
        <span className="k-gloss-note"> · {word.glossNote}</span>
      ) : null}
    </p>
  );
}

const POS_NAME: Record<string, string> = {
  verb: "verb",
  noun: "noun",
  adj: "adjective",
  adv: "adverb",
  prep: "preposition",
  pron: "pronoun",
  conj: "conjunction",
  num: "number",
  name: "name",
};

/** The pronunciation, the part of speech in small capitals and a verb's helper ("verb · with hebben"). */
export function CardPos({ entry }: { entry: Entry }) {
  const name = POS_NAME[entry.pos] ?? entry.pos;
  const helper = { heeft: "hebben", is: "zijn", "heeft / is": "hebben or zijn" }[
    helperOf(entry.forms ?? {}) ?? ""
  ];
  if (!name) return null;
  return (
    <>
      {entry.ipa ? <p className="card-ipa">{entry.ipa}</p> : null}
      <p className="card-pos">
        {name}
        {helper ? <span> · with {helper}</span> : null}
      </p>
    </>
  );
}

/** How many meanings the card shows before "N more meanings". */
const SENSES_SHOWN = 3;

/**
 * The meanings as a dictionary has them (WC11): numbered in circles, the one in this sentence
 * marked, same-meaning words under their own meaning, an example in italics with its English.
 * Three show; the rest open in place. Old and specialist meanings come last.
 */
export function CardSenses({
  word,
  entry,
  onOpen,
}: {
  word: InspectorEntry;
  entry: Entry;
  onOpen?: ((word: string) => void) | undefined;
}) {
  const [all, setAll] = useState(false);
  const senses: EntrySense[] = entry.extras?.senses?.length
    ? [...entry.extras.senses.filter((s) => !s.mark), ...entry.extras.senses.filter((s) => s.mark)]
    : entry.glosses.map((gloss) => ({ gloss }));
  if (!senses.length) return <CardMeaning word={word} />;
  const here =
    word.sentenceGloss ?? (word.glossNote === "in this sentence" ? word.glosses[0] : null);
  const hereAt = here ? senses.findIndex((s) => !s.mark && sameMeaning(s.gloss, here)) : -1;
  const shown = all ? senses : senses.slice(0, SENSES_SHOWN);
  // The sentence's meaning shows even when it's further down the list.
  const list =
    !all && hereAt >= SENSES_SHOWN ? [...shown.slice(0, SENSES_SHOWN - 1), senses[hereAt]!] : shown;
  return (
    <div className="card-senses">
      {here && hereAt < 0 ? (
        <p className="card-senses-here" data-peek="">
          <span className="card-here">in this sentence</span> {here}
        </p>
      ) : null}
      <ol>
        {list.map((s) => {
          const n = senses.indexOf(s);
          return (
            <li
              key={n}
              data-n={n + 1}
              {...(s.mark ? { "data-mark": s.mark } : {})}
              // The phone's peek shows one meaning: this sentence's, else the first.
              {...(n === hereAt || (!here && n === 0) ? { "data-peek": "" } : {})}
            >
              <span className="card-sense-gloss">
                {s.gloss}
                {n === hereAt ? <span className="card-here">in this sentence</span> : null}
                {s.mark ? <span className="card-sense-mark">{s.mark}</span> : null}
              </span>
              {s.synonyms?.length ? (
                <span className="card-sense-same">
                  <span className="card-sense-label">same meaning</span>
                  {s.synonyms.slice(0, 4).map((w, k) => (
                    <span key={w}>
                      {k ? " · " : ""}
                      {onOpen && !w.includes(" ") ? (
                        <button
                          type="button"
                          className="card-word"
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
                </span>
              ) : null}
              {s.examples?.[0] ? (
                <span className="card-sense-example">
                  <span lang="nl">{s.examples[0].nl}</span>
                  {s.examples[0].en ? (
                    <span className="card-sense-en">{s.examples[0].en}</span>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {senses.length > SENSES_SHOWN ? (
        <button type="button" className="k-link card-senses-more" onClick={() => setAll(!all)}>
          {all ? "Fewer meanings" : `${senses.length - SENSES_SHOWN} more meanings`}
        </button>
      ) : null}
    </div>
  );
}

/** Related words: a small label over each row, the words in a line (WC11, dictionary style). */
export function CardRelated({
  entry,
  onOpen,
  full = false,
  withSame = true,
}: {
  entry: Entry;
  onOpen?: ((word: string) => void) | undefined;
  full?: boolean;
  /** Same meaning as a row (off when the meanings show it under their own sense). */
  withSame?: boolean;
}) {
  const { same: sameWords, opposite } = related(entry);
  const same = withSame ? sameWords : [];
  const family = entry.family ?? [];
  const rows: [string, string[]][] = [
    ["Base verb", entry.base ? [entry.base] : []],
    ["Same meaning", same],
    ["Opposite", opposite],
    ["Family", full ? family : family.slice(0, 6)],
    ...(full ? ([["Related", entry.extras?.related ?? []]] as [string, string[]][]) : []),
  ];
  const shown = rows.filter(([, v]) => v.length);
  if (!shown.length) return null;
  return (
    <dl className="card-related">
      {shown.map(([label, words]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {words.map((w, k) => (
              <span key={w}>
                {k ? <span className="card-dot"> · </span> : null}
                {onOpen && !w.includes(" ") ? (
                  <button type="button" className="card-word" lang="nl" onClick={() => onOpen(w)}>
                    {w}
                  </button>
                ) : (
                  <span className="card-word" data-plain="" lang="nl">
                    {w}
                  </span>
                )}
              </span>
            ))}
            {!full && label === "Family" && family.length > 6 ? (
              <span className="card-more">+{family.length - 6}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** What the full entry adds, in a few words: "2 meanings · all forms · 24 family words". */
function fullSummary(entry: Entry): string {
  const senses = entry.extras?.senses?.length ?? entry.glosses.length;
  const forms = formRows(entry);
  const family = entry.family?.length ?? 0;
  return [
    senses > 1 ? `${senses} meanings` : null,
    forms.all.length > forms.short.length ? "all forms" : null,
    family > 6 ? `${family} family words` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The card's extra actions: Full entry (and what it adds), the level. */
export function CardExtra({
  entry,
  full,
  onFull,
}: {
  entry: Entry | null;
  full: boolean;
  onFull?: ((full: boolean) => void) | undefined;
}) {
  const summary = entry && !full ? fullSummary(entry) : "";
  return (
    <div className="card-extra">
      {onFull && entry ? (
        <button type="button" className="k-link" aria-pressed={full} onClick={() => onFull(!full)}>
          {full ? "Smaller ⤡" : "Full entry ⤢"}
          {summary ? <span className="card-extra-summary"> {summary}</span> : null}
        </button>
      ) : null}
      {entry?.level ? <span className="card-extra-level">about {entry.level}</span> : null}
    </div>
  );
}

/**
 * The full entry: what the card leaves out. Under the head "verb · separable · about A2 · heeft
 * opengedaan"; the meanings numbered, the one in your sentence first and marked, with examples
 * and their English; old and specialist meanings last, labelled; every form; every related word.
 */
export function FullEntry({
  entry,
  word,
  onOpen,
  onSay,
}: {
  entry: Entry;
  word: InspectorEntry;
  onOpen?: ((word: string) => void) | undefined;
  onSay?: ((text: string) => void) | undefined;
}) {
  const f = entry.forms ?? {};
  const participle = asString(f["participle"]);
  const helper = helperOf(f);
  const facts = [
    entry.pos === "adj" ? "adjective" : entry.pos,
    f["separable"] ? "separable" : null,
    entry.level ? `about ${entry.level}` : null,
    helper && participle ? `${helper} ${participle}` : null,
  ].filter(Boolean);
  const here = word.sentenceGloss ?? word.glosses[0] ?? null;
  const senses: EntrySense[] = entry.extras?.senses ?? entry.glosses.map((gloss) => ({ gloss }));
  const inSentence = here ? senses.findIndex((s) => !s.mark && sameMeaning(s.gloss, here)) : -1;
  const ordered =
    inSentence > 0 ? [senses[inSentence]!, ...senses.filter((_, k) => k !== inSentence)] : senses;
  return (
    <section className="full-entry" aria-label="Full entry">
      <p className="full-entry-facts">{facts.join(" · ")}</p>
      <ol className="full-entry-senses">
        {ordered.map((s, k) => (
          <li key={k} {...(s.mark ? { "data-mark": s.mark } : {})}>
            <span className="full-entry-gloss">{s.gloss}</span>
            {k === 0 && inSentence >= 0 ? (
              <span className="full-entry-here">in your sentence</span>
            ) : null}
            {s.mark ? <span className="full-entry-mark">{s.mark}</span> : null}
            {s.examples?.map((ex, n) => (
              <span key={n} className="full-entry-example">
                <span lang="nl">{ex.nl}</span>
                {ex.en ? <span className="full-entry-en">{ex.en}</span> : null}
              </span>
            ))}
          </li>
        ))}
      </ol>
      <CardForms entry={entry} surface={word.surface} onSay={onSay} all />
      <CardRelated entry={entry} onOpen={onOpen} full />
    </section>
  );
}
