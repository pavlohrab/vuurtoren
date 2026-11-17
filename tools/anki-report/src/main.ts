/**
 * M1 gate report: detect ALL target-language decks, map cards to headword keys, build the
 * merged learner model and write a review sample.
 *   pnpm anki-report [--deck NAME ...] [--min-share 0.5] [--lang nl] [--sample 100]
 *                    [--anki URL] [--key APIKEY] [--nlp URL] [--seed 42]
 * Read-only: it never modifies or syncs your collection.
 * Writes reports/ (git-ignored: it contains your personal deck data).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  AnkiConnectClient,
  type Candidate,
  type CardExtras,
  type CardInfo,
  type NoteInfo,
  type NoteSample,
  ankiEscape,
  cleanField,
  exactDeckQuery,
  noteMemory,
  rankCandidates,
  selectCandidates,
} from "@app/anki";
import {
  type WordKnowledge,
  buildLearnerModel,
  classifyCard,
  containsTerm,
  summarizeModel,
} from "@app/core";
import { NlpClient, type NlpLang, type TermAnalysis } from "@app/nlp-client";

const { values: args } = parseArgs({
  options: {
    deck: { type: "string", multiple: true },
    "min-share": { type: "string", default: "0.5" },
    lang: { type: "string", default: "nl" },
    sample: { type: "string", default: "100" },
    anki: { type: "string", default: "http://127.0.0.1:8765" },
    key: { type: "string" },
    nlp: { type: "string", default: "http://localhost:8000" },
    seed: { type: "string", default: "42" },
  },
});

const lang = args.lang as NlpLang;
const SAMPLE_PER_DECK = 30;
const MIN_DECK_NOTES = 10;
const reportsDir = new URL("../../../reports/", import.meta.url);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(Number(args.seed));
function sample<T>(xs: T[], n: number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const fieldValues = (n: NoteInfo) =>
  Object.fromEntries(Object.entries(n.fields).map(([k, v]) => [k, v.value]));

interface Row {
  source: Candidate;
  note: NoteInfo;
  raw: string;
  cleaned: string;
  term: TermAnalysis;
  studied: boolean;
  knowledge: WordKnowledge;
}

async function main(): Promise<void> {
  const anki = new AnkiConnectClient(
    args.key ? { url: args.anki, apiKey: args.key } : { url: args.anki },
  );
  const nlp = new NlpClient({ url: args.nlp });

  const version = await anki.version();
  const v1 = await anki.hasV1();
  const health = await nlp.health();
  console.log(`AnkiConnect v${version}${v1 ? " (+ API v1)" : ""} · NLP ${health.version}`);

  // 1. Detect every deck/note type whose word field is in the target language.
  const samples: NoteSample[] = [];
  const decks = (await anki.deckNames()).filter((d) => !args.deck || args.deck.includes(d));
  for (const d of decks) {
    const ids = await anki.findNotes(exactDeckQuery(d));
    if (ids.length < MIN_DECK_NOTES && !args.deck) continue;
    for (const n of await anki.notesInfo(sample(ids, SAMPLE_PER_DECK))) {
      samples.push({
        deck: d,
        deckNoteCount: ids.length,
        modelName: n.modelName,
        fields: fieldValues(n),
      });
    }
  }
  console.log(`Sampled ${samples.length} notes from ${decks.length} decks; detecting language…`);
  const candidates = await rankCandidates(samples, (t) => nlp.detect(t), lang);
  const minShare = Number(args["min-share"]);
  const selected = selectCandidates(candidates, minShare);
  if (!selected.length)
    throw new Error(`No ${lang} vocabulary decks found (min share ${minShare}).`);
  console.log(`Selected ${selected.length} deck/note-type pairs:`);
  for (const c of selected) {
    console.log(`  ${c.deck} [${c.modelName}] word=${c.wordField} ${lang}=${pct(c.targetShare)}`);
  }

  // 2. Load notes + cards for each selection.
  const loaded: { source: Candidate; notes: NoteInfo[]; cards: CardInfo[] }[] = [];
  for (const c of selected) {
    const ids = await anki.findNotes(`${exactDeckQuery(c.deck)} "note:${ankiEscape(c.modelName)}"`);
    const notes = await anki.notesInfo(ids);
    const cards = await anki.cardsInfo(notes.flatMap((n) => n.cards));
    loaded.push({ source: c, notes, cards });
  }
  const allCards = loaded.flatMap((l) => l.cards);
  const reviewed = allCards.filter((c) => c.type !== 0).map((c) => c.cardId);

  // 3. Memory signals: last review (all versions) + FSRS memory (v1, if FSRS is on).
  const extras: CardExtras = { lastReviewMs: await anki.lastReviews(reviewed) };
  let fsrsCards = 0;
  if (v1 && reviewed.length) {
    extras.fsrs = await anki.fsrsMemory(reviewed);
    fsrsCards = [...extras.fsrs.values()].filter(Boolean).length;
  }
  console.log(
    `${allCards.length} cards, ${reviewed.length} reviewed; FSRS memory on ${fsrsCards} cards` +
      (fsrsCards ? "" : " (FSRS off → SM-2 interval decay)"),
  );

  // 4. Same analyzer as for texts.
  const now = Date.now();
  const pending = loaded.flatMap(({ source, notes, cards }) => {
    const byNote = new Map<number, CardInfo[]>();
    for (const c of cards) byNote.set(c.note, [...(byNote.get(c.note) ?? []), c]);
    return notes.map((note) => {
      const raw = note.fields[source.wordField]?.value ?? "";
      const memory = noteMemory(byNote.get(note.noteId) ?? [], extras);
      return { source, note, raw, cleaned: cleanField(raw), memory };
    });
  });
  const terms = await nlp.analyzeTerms(
    lang,
    pending.map((p) => p.cleaned),
  );
  const rows: Row[] = pending.map((p, i) => ({
    source: p.source,
    note: p.note,
    raw: p.raw,
    cleaned: p.cleaned,
    term: terms[i]!,
    studied: !p.memory.isNew,
    knowledge: classifyCard(p.memory, now),
  }));
  const memories = new Map(pending.map((p, i) => [rows[i]!, p.memory]));

  // 4b. Text-side check: the card's own example sentence must contain its headword
  // (contextual lemma or surface). This measures card <-> text matching on real data.
  const sentenceOf = (r: Row) =>
    r.source.sentenceField ? cleanField(r.note.fields[r.source.sentenceField]?.value ?? "") : "";
  // Skip sentences where the deck already blanked the word out ("Waar kom jij ____ ?").
  const withSentence = rows.filter(
    (r) => r.term.key && sentenceOf(r) && !/_{2,}/.test(sentenceOf(r)),
  );
  const sentences = withSentence.map(sentenceOf);
  console.log(`Checking ${sentences.length} example sentences…`);
  const analyses = await nlp.analyzeText(lang, sentences);
  const misses = withSentence
    .map((r, i) => ({ r, sentence: sentences[i]!, tokens: analyses[i]!.tokens }))
    .filter(
      ({ r, tokens }) => ![r.term.key, ...r.term.aliases].some((k) => containsTerm(tokens, k)),
    );
  const hitRate = withSentence.length ? 1 - misses.length / withSentence.length : 0;
  const studiedWithSentence = withSentence.filter((r) => r.studied).length;
  const studiedMisses = misses.filter((m) => m.r.studied).length;

  // 5. Merged learner model (headword + aliases).
  const model = buildLearnerModel(
    rows.flatMap((r) =>
      [r.term.key, ...r.term.aliases].map((key) => ({ key, memory: memories.get(r)! })),
    ),
    now,
  );
  const counts = summarizeModel(model);

  const decksOfKey = new Map<string, Set<string>>();
  const perDeckKey = new Map<string, number>();
  for (const r of rows) {
    if (!r.term.key) continue;
    decksOfKey.set(r.term.key, (decksOfKey.get(r.term.key) ?? new Set()).add(r.source.deck));
    const dk = `${r.source.deck}\u0000${r.term.key}`;
    perDeckKey.set(dk, (perDeckKey.get(dk) ?? 0) + 1);
  }
  const overlap = [...decksOfKey].filter(([, d]) => d.size > 1).length;
  const homographs = [...perDeckKey].filter(([, n]) => n > 1).length;
  const empty = rows.filter((r) => !r.term.key);
  const studiedRows = rows.filter((r) => r.studied);

  const perDeck = loaded.map(({ source }) => {
    const rs = rows.filter((r) => r.source === source);
    const by = (s: string) => rs.filter((r) => r.knowledge.state === s).length;
    return {
      source,
      notes: rs.length,
      known: by("known"),
      learning: by("learning"),
      unknown: by("unknown"),
    };
  });

  // 6. Review sample: half from studied notes (they drive "known"), half from the rest.
  await mkdir(reportsDir, { recursive: true });
  const n = Number(args.sample);
  const usable = rows.filter((r) => r.term.key);
  const fromStudied = sample(
    usable.filter((r) => r.studied),
    Math.ceil(n / 2),
  );
  const picked = [
    ...fromStudied,
    ...sample(
      usable.filter((r) => !r.studied),
      n - fromStudied.length,
    ),
  ];
  await writeFile(
    new URL("m1-mapping-sample.csv", reportsDir),
    [
      "#,deck,raw,cleaned,key,aliases,pos,article,reflexive,spacy_lemma,state,p_known,correct (y/n),note",
    ]
      .concat(
        picked.map((r, i) =>
          [
            i + 1,
            r.source.deck,
            r.raw,
            r.cleaned,
            r.term.key,
            r.term.aliases.join(" | "),
            r.term.pos,
            r.term.article,
            r.term.reflexive,
            r.term.lemma,
            r.knowledge.state,
            r.knowledge.pKnown.toFixed(2),
            "",
            "",
          ]
            .map(csv)
            .join(","),
        ),
      )
      .join("\n"),
  );

  const summary = {
    generated: new Date(now).toISOString(),
    ankiconnect: { version, v1 },
    lang,
    fsrsCards,
    sources: perDeck.map((d) => ({
      deck: d.source.deck,
      model: d.source.modelName,
      field: d.source.wordField,
      share: d.source.targetShare,
      notes: d.notes,
      known: d.known,
      learning: d.learning,
      unknown: d.unknown,
    })),
    notes: rows.length,
    cards: allCards.length,
    reviewedCards: reviewed.length,
    uniqueKeys: model.size,
    states: counts,
    emptyKeys: empty.length,
    sentenceCheck: { checked: withSentence.length, misses: misses.length, hitRate },
    crossDeckOverlap: overlap,
    withinDeckHomographs: homographs,
  };
  await writeFile(new URL("m1-summary.json", reportsDir), JSON.stringify(summary, null, 2));

  const md = `# M1 mapping report — ${summary.generated}

AnkiConnect v${version}${v1 ? " + API v1" : ""} · FSRS memory on ${fsrsCards} cards${fsrsCards ? "" : " (FSRS off: recall estimated as 0.9^(days since review / interval))"}

## Sources (all ${lang} decks, merged)
| deck | note type | word field | ${lang} share | notes | known | learning | unknown |
|---|---|---|---|---|---|---|---|
${perDeck.map((d) => `| ${d.source.deck} | ${d.source.modelName} | ${d.source.wordField} | ${pct(d.source.targetShare)} | ${d.notes} | ${d.known} | ${d.learning} | ${d.unknown} |`).join("\n")}

Other detected candidates not selected: ${
    candidates
      .filter((c) => !selected.includes(c))
      .map((c) => `${c.deck} (${pct(c.targetShare)})`)
      .join(", ") || "none"
  }

## Merged learner model
| | |
|---|---|
| notes / cards / reviewed cards | ${rows.length} / ${allCards.length} / ${reviewed.length} |
| unique keys (headwords + aliases) | ${model.size} |
| known / learning / unknown | ${counts.known} / ${counts.learning} / ${counts.unknown} |
| studied notes | ${studiedRows.length} |
| empty keys (unusable field) | ${empty.length} |
| words in more than one deck (merged) | ${overlap} |
| homographs within a deck (e.g. adj + adv) | ${homographs} |

## Text-side check: headword found in its own example sentence
**${pct(hitRate)}** of ${withSentence.length} sentences (studied notes: ${studiedWithSentence - studiedMisses}/${studiedWithSentence}).
A miss means the analyzer would not connect this card to the word in running text.

| key | sentence | analyzer tokens (text/lemma) |
|---|---|---|
${sample(misses, 60)
  .map(
    ({ r, sentence, tokens }) =>
      `| ${r.term.key} | ${sentence.slice(0, 90)} | ${tokens
        .filter((t) => t.is_word)
        .map((t) => (t.text.toLowerCase() === t.lemma ? t.text : `${t.text}/${t.lemma}`))
        .join(" ")
        .slice(0, 120)} |`,
  )
  .join("\n")}

## Empty keys (first 20)
${
  empty
    .slice(0, 20)
    .map((r) => `- ${r.source.deck}: \`${r.raw.slice(0, 80)}\``)
    .join("\n") || "none"
}

## Your task (the M1 gate)
Open \`m1-mapping-sample.csv\` (${fromStudied.length} studied + ${picked.length - fromStudied.length} unstudied rows) and fill **correct (y/n)**:
is \`key\` the right dictionary word for that card? Target: ≥ 95% correct.
`;
  await writeFile(new URL("m1-report.md", reportsDir), md);

  console.log(
    `\n${rows.length} notes → ${model.size} keys · known ${counts.known} · learning ${counts.learning} · unknown ${counts.unknown}` +
      `\nempty ${empty.length} · cross-deck overlap ${overlap} · homographs ${homographs}` +
      `\nheadword found in own sentence: ${pct(hitRate)} of ${withSentence.length} (${misses.length} misses)` +
      `\nWrote ${reportsDir.pathname}{m1-report.md, m1-mapping-sample.csv, m1-summary.json}`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
