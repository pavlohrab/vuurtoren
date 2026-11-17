/**
 * M1 gate report: build the Anki snapshot (all target-language decks), check that each
 * card's headword is found in its own example sentence, and write a review sample.
 *   pnpm anki-report [--deck NAME ...] [--min-share 0.5] [--lang nl] [--sample 100]
 *                    [--anki URL] [--key APIKEY] [--nlp URL] [--seed 42]
 * Read-only: it never modifies or syncs your collection.
 * Writes reports/ (git-ignored: it contains your personal deck data).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { AnkiConnectClient, type SnapshotNote, buildSnapshot, cleanField } from "@app/anki";
import { containsTerm } from "@app/core";
import { NlpClient, type NlpLang } from "@app/nlp-client";

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
const cell = (v: unknown) =>
  String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

async function main(): Promise<void> {
  const anki = new AnkiConnectClient(
    args.key ? { url: args.anki, apiKey: args.key } : { url: args.anki },
  );
  const nlp = new NlpClient({ url: args.nlp });
  const version = await anki.version();
  const v1 = await anki.hasV1();
  console.log(
    `AnkiConnect v${version}${v1 ? " (+ API v1)" : ""} · NLP ${(await nlp.health()).version}`,
  );

  const minShare = Number(args["min-share"]);
  const snap = await buildSnapshot({
    anki,
    lang,
    detect: (t) => nlp.detect(t),
    analyzeTerms: (t) => nlp.analyzeTerms(lang, t),
    minShare,
    random: rand,
    onProgress: (m) => console.log(`  ${m}`),
    ...(args.deck ? { decks: args.deck } : {}),
  });
  const rows = snap.notes;
  const counts = { known: 0, learning: 0, unknown: 0 };
  for (const e of snap.entries) if (e.state in counts) counts[e.state as keyof typeof counts]++;

  // Text-side check: the card's own example sentence must contain its headword.
  const sentenceOf = (r: SnapshotNote) =>
    r.source.sentenceField ? cleanField(r.note.fields[r.source.sentenceField]?.value ?? "") : "";
  const withSentence = rows.filter(
    (r) => r.term.key && sentenceOf(r) && !/_{2,}/.test(sentenceOf(r)),
  );
  console.log(`Checking ${withSentence.length} example sentences…`);
  const analyses = await nlp.analyzeText(lang, withSentence.map(sentenceOf));
  const misses = withSentence
    .map((r, i) => ({ r, sentence: sentenceOf(r), tokens: analyses[i]!.tokens }))
    .filter(
      ({ r, tokens }) => ![r.term.key, ...r.term.aliases].some((k) => containsTerm(tokens, k)),
    );
  const hitRate = withSentence.length ? 1 - misses.length / withSentence.length : 0;
  const studiedChecked = withSentence.filter((r) => r.studied).length;
  const studiedMisses = misses.filter((m) => m.r.studied).length;

  const decksOfKey = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.term.key)
      decksOfKey.set(r.term.key, (decksOfKey.get(r.term.key) ?? new Set()).add(r.source.deck));
  }
  const overlap = [...decksOfKey].filter(([, d]) => d.size > 1).length;
  const empty = rows.filter((r) => !r.term.key);
  const perDeck = snap.sources.map((source) => {
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
    ["#,deck,raw,cleaned,key,aliases,state,p_known,correct (y/n),note"]
      .concat(
        picked.map((r, i) =>
          [
            i + 1,
            r.source.deck,
            r.raw,
            r.cleaned,
            r.term.key,
            r.term.aliases.join(" | "),
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
    generated: new Date().toISOString(),
    ankiconnect: { version, v1 },
    lang,
    fsrsCards: snap.fsrsCards,
    sources: perDeck.map((d) => ({
      deck: d.source.deck,
      model: d.source.modelName,
      word: d.source.wordField,
      gloss: d.source.glossField,
      sentence: d.source.sentenceField,
      share: d.source.targetShare,
      notes: d.notes,
      known: d.known,
      learning: d.learning,
      unknown: d.unknown,
    })),
    notes: rows.length,
    cards: snap.cards,
    reviewedCards: snap.reviewedCards,
    keys: snap.entries.length,
    states: counts,
    emptyKeys: empty.length,
    crossDeckOverlap: overlap,
    sentenceCheck: { checked: withSentence.length, misses: misses.length, hitRate },
  };
  await writeFile(new URL("m1-summary.json", reportsDir), JSON.stringify(summary, null, 2));

  const md = `# M1 mapping report — ${summary.generated}

AnkiConnect v${version}${v1 ? " + API v1" : ""} · FSRS memory on ${snap.fsrsCards} cards${snap.fsrsCards ? "" : " (FSRS off: recall estimated as 0.9^(days since review / interval))"}

## Sources (all ${lang} decks, merged)
| deck | note type | word | gloss | sentence | ${lang} share | notes | known | learning | unknown |
|---|---|---|---|---|---|---|---|---|---|
${perDeck.map((d) => `| ${cell(d.source.deck)} | ${cell(d.source.modelName)} | ${cell(d.source.wordField)} | ${cell(d.source.glossField ?? "-")} | ${cell(d.source.sentenceField ?? "-")} | ${pct(d.source.targetShare)} | ${d.notes} | ${d.known} | ${d.learning} | ${d.unknown} |`).join("\n")}

Not selected: ${
    snap.candidates
      .filter((c) => !snap.sources.includes(c))
      .map((c) => `${c.deck} (${pct(c.targetShare)})`)
      .join(", ") || "none"
  }

## Merged learner model
| | |
|---|---|
| notes / cards / reviewed cards | ${rows.length} / ${snap.cards} / ${snap.reviewedCards} |
| unique keys (headwords + aliases) | ${snap.entries.length} |
| known / learning / unknown | ${counts.known} / ${counts.learning} / ${counts.unknown} |
| empty keys (unusable field) | ${empty.length} |
| words in more than one deck (merged) | ${overlap} |

## Text-side check: headword found in its own example sentence
**${(hitRate * 100).toFixed(1)}%** of ${withSentence.length} sentences (studied notes: ${studiedChecked - studiedMisses}/${studiedChecked}).

| key | sentence | analyzer tokens (text/lemma) |
|---|---|---|
${sample(misses, 60)
  .map(
    ({ r, sentence, tokens }) =>
      `| ${cell(r.term.key)} | ${cell(sentence.slice(0, 90))} | ${tokens
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
`;
  await writeFile(new URL("m1-report.md", reportsDir), md);
  console.log(
    `\n${rows.length} notes → ${snap.entries.length} keys · known ${counts.known} · learning ${counts.learning} · unknown ${counts.unknown}` +
      `\nheadword found in own sentence: ${(hitRate * 100).toFixed(1)}% of ${withSentence.length} (${misses.length} misses)` +
      `\nglosses from: ${[...new Set(snap.sources.map((s) => s.glossField ?? "-"))].join(", ")}` +
      `\nWrote ${reportsDir.pathname}{m1-report.md, m1-mapping-sample.csv, m1-summary.json}`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
