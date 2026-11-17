/**
 * M1 gate report.
 *   pnpm anki-report [--deck NAME --model NAME --field NAME] [--lang nl] [--sample 100]
 *                    [--anki URL] [--key APIKEY] [--nlp URL] [--seed 42]
 * Requires: Anki desktop running with AnkiConnect, and server/nlp running.
 * Writes reports/ (git-ignored: it contains your personal deck data).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  AnkiConnectClient,
  type CardInfo,
  type NoteInfo,
  type NoteSample,
  ankiEscape,
  cleanField,
  exactDeckQuery,
  noteMemory,
  rankCandidates,
} from "@app/anki";
import { buildLearnerModel, classifyCard, summarizeModel } from "@app/core";
import { NlpClient, type NlpLang } from "@app/nlp-client";

const { values: args } = parseArgs({
  options: {
    deck: { type: "string" },
    model: { type: "string" },
    field: { type: "string" },
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
const fieldValues = (n: NoteInfo) =>
  Object.fromEntries(Object.entries(n.fields).map(([k, v]) => [k, v.value]));

async function main(): Promise<void> {
  const anki = new AnkiConnectClient(
    args.key ? { url: args.anki, apiKey: args.key } : { url: args.anki },
  );
  const nlp = new NlpClient({ url: args.nlp });

  const version = await anki.version();
  const v1 = await anki.hasV1();
  const health = await nlp.health();
  console.log(`AnkiConnect v${version}${v1 ? " (+ API v1)" : ""} · NLP ${health.version}`);

  // 1. Detect deck / note type / field (unless given).
  let deck = args.deck;
  let model = args.model;
  let field = args.field;
  let candidatesText = "";
  if (!deck || !model || !field) {
    const samples: NoteSample[] = [];
    const decks = (await anki.deckNames()).filter((d) => !deck || d === deck);
    for (const d of decks) {
      const ids = await anki.findNotes(exactDeckQuery(d));
      if (ids.length < MIN_DECK_NOTES) continue;
      for (const n of await anki.notesInfo(sample(ids, SAMPLE_PER_DECK))) {
        if (model && n.modelName !== model) continue;
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
    if (!candidates.length)
      throw new Error(`No deck with ${lang} vocabulary found. Pass --deck/--model/--field.`);
    candidatesText = candidates
      .slice(0, 5)
      .map(
        (c, i) =>
          `${i + 1}. ${c.deck} [${c.modelName}] notes=${c.noteCount} word=${c.wordField} ` +
          `sentence=${c.sentenceField ?? "-"} gloss=${c.glossField ?? "-"} ${lang}=${(c.targetShare * 100).toFixed(0)}% ` +
          `e.g. ${c.examples.slice(0, 3).join(" · ")}`,
      )
      .join("\n");
    console.log(`Candidates:\n${candidatesText}`);
    const top = candidates[0]!;
    deck ??= top.deck;
    model ??= top.modelName;
    field ??= top.wordField;
  }
  console.log(`Using deck "${deck}", note type "${model}", field "${field}"`);

  // 2. Load all notes and cards of the chosen deck + note type.
  const noteIds = await anki.findNotes(`${exactDeckQuery(deck)} "note:${ankiEscape(model)}"`);
  const notes = await anki.notesInfo(noteIds);
  const cards = await anki.cardsInfo(notes.flatMap((n) => n.cards));
  const cardsByNote = new Map<number, CardInfo[]>();
  for (const c of cards) cardsByNote.set(c.note, [...(cardsByNote.get(c.note) ?? []), c]);

  // 3. Same analyzer as for texts.
  const raw = notes.map((n) => n.fields[field]?.value ?? "");
  const cleaned = raw.map(cleanField);
  const terms = await nlp.analyzeTerms(lang, cleaned);

  // 4. Learner model.
  const now = Date.now();
  const rows = notes.map((n, i) => {
    const memory = noteMemory(cardsByNote.get(n.noteId) ?? []);
    return {
      note: n,
      raw: raw[i]!,
      cleaned: cleaned[i]!,
      term: terms[i]!,
      memory,
      knowledge: classifyCard(memory, now),
    };
  });
  const model_ = buildLearnerModel(
    rows.map((r) => ({ key: r.term.key, memory: r.memory })),
    now,
  );
  const counts = summarizeModel(model_);

  const byKey = new Map<string, number>();
  for (const r of rows) if (r.term.key) byKey.set(r.term.key, (byKey.get(r.term.key) ?? 0) + 1);
  const collisions = [...byKey].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  const empty = rows.filter((r) => !r.term.key);
  const multi = rows.filter((r) => r.term.multiword);
  const changed = rows.filter((r) => r.term.key && r.term.key !== r.cleaned.toLowerCase());
  const pos = new Map<string, number>();
  for (const r of rows) pos.set(r.term.pos || "-", (pos.get(r.term.pos || "-") ?? 0) + 1);

  // 5. Write reports.
  await mkdir(reportsDir, { recursive: true });
  const n = Number(args.sample);
  const picked = sample(
    rows.filter((r) => r.term.key),
    n,
  );
  await writeFile(
    new URL("m1-mapping-sample.csv", reportsDir),
    ["#,raw,cleaned,key,pos,article,multiword,state,p_known,correct (y/n),note"]
      .concat(
        picked.map((r, i) =>
          [
            i + 1,
            r.raw,
            r.cleaned,
            r.term.key,
            r.term.pos,
            r.term.article,
            r.term.multiword,
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

  // Save the v1 API description so FSRS fields (scheduling.get) can be wired up against the real schema.
  if (v1) {
    try {
      const describe = JSON.stringify(await anki.rpc("api.describe"), null, 2);
      await writeFile(new URL("ankiconnect-v1-describe.json", reportsDir), describe);
    } catch (e) {
      console.warn(`Could not save api.describe: ${String(e)}`);
    }
  }

  const summary = {
    generated: new Date(now).toISOString(),
    ankiconnect: { version, v1 },
    deck,
    model,
    field,
    lang,
    notes: notes.length,
    cards: cards.length,
    uniqueLemmas: model_.size,
    states: counts,
    emptyKeys: empty.length,
    multiword: multi.length,
    normalisedByAnalyzer: changed.length,
    collisions: collisions.length,
    pos: Object.fromEntries([...pos].sort((a, b) => b[1] - a[1])),
  };
  await writeFile(new URL("m1-summary.json", reportsDir), JSON.stringify(summary, null, 2));

  const md = `# M1 mapping report — ${summary.generated}

AnkiConnect v${version}${v1 ? " + API v1 (see ankiconnect-v1-describe.json)" : ""}

## Detection
${candidatesText ? "```\n" + candidatesText + "\n```" : "(given on command line)"}

**Chosen:** deck \`${deck}\` · note type \`${model}\` · word field \`${field}\`

## Summary
| | |
|---|---|
| notes / cards | ${notes.length} / ${cards.length} |
| unique lemmas | ${model_.size} |
| known / learning / unknown | ${counts.known} / ${counts.learning} / ${counts.unknown} |
| empty keys (unusable field) | ${empty.length} |
| multiword entries | ${multi.length} |
| changed by analyzer (inflected/article/etc.) | ${changed.length} |
| lemma collisions (>1 note per lemma) | ${collisions.length} |

## Top collisions
${
  collisions
    .slice(0, 20)
    .map(([k, c]) => `- \`${k}\` × ${c}`)
    .join("\n") || "none"
}

## Empty keys (first 20)
${
  empty
    .slice(0, 20)
    .map((r) => `- \`${r.raw.slice(0, 80)}\``)
    .join("\n") || "none"
}

## Analyzer changes (first 40)
${
  changed
    .slice(0, 40)
    .map(
      (r) =>
        `- ${r.cleaned} → **${r.term.key}** (${r.term.pos}${r.term.article ? ", " + r.term.article : ""})`,
    )
    .join("\n") || "none"
}

## Your task (the M1 gate)
Open \`m1-mapping-sample.csv\`, fill **correct (y/n)** for the ${picked.length} rows. Target: ≥ 95% correct.
`;
  await writeFile(new URL("m1-report.md", reportsDir), md);

  console.log(
    `\n${notes.length} notes → ${model_.size} lemmas · known ${counts.known} · learning ${counts.learning} · unknown ${counts.unknown}` +
      `\nempty ${empty.length} · multiword ${multi.length} · collisions ${collisions.length}` +
      `\nWrote ${new URL(".", reportsDir).pathname}{m1-report.md, m1-mapping-sample.csv, m1-summary.json}`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
