/**
 * Auto-detect which deck / note type / field holds target-language vocabulary.
 * Pure ranking logic: the caller supplies sampled notes and a language detector.
 */
import { cleanField } from "./clean.js";

export interface NoteSample {
  deck: string;
  deckNoteCount: number;
  modelName: string;
  fields: Record<string, string>;
}

export interface Detection {
  lang: string | null;
  confidence: number;
}

export type DetectFn = (texts: string[]) => Promise<Detection[]>;

export interface FieldStats {
  name: string;
  samples: number;
  targetShare: number;
  glossShare: number;
  avgTokens: number;
}

export interface Candidate {
  deck: string;
  modelName: string;
  noteCount: number;
  wordField: string;
  sentenceField: string | null;
  glossField: string | null;
  /** Target-language share of the word field. */
  targetShare: number;
  /**
   * Evidence that this deck is target-language vocabulary: the word-field share, or the
   * sentence-field share when that is strong (single headwords are hard to identify;
   * whole example sentences are not).
   */
  confidence: number;
  score: number;
  fields: FieldStats[];
  examples: string[];
}

const WORD_NAME =
  /^(word|woord|front|voorkant|expression|vocab|vocabulary|target|term|dutch|nederlands|nl|lemma|headword)$/i;
const SENTENCE_NAME = /(sentence|zin|example|voorbeeld|context)/i;
const GLOSS_NAME =
  /^(betekenis|definition|meaning|translation|vertaling|gloss|english|back|achterkant)$/i;

function tokens(s: string): number {
  return s ? s.split(/\s+/).length : 0;
}

export async function rankCandidates(
  samples: NoteSample[],
  detect: DetectFn,
  targetLang: string,
  glossLang = "en",
): Promise<Candidate[]> {
  // Group by (deck, model) — field names are defined per note type.
  const groups = new Map<string, NoteSample[]>();
  for (const s of samples) {
    const k = `${s.deck}\u0000${s.modelName}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }

  // One batched detection call for every non-empty sampled value.
  const texts: string[] = [];
  const index = new Map<string, number>();
  for (const s of samples) {
    for (const v of Object.values(s.fields)) {
      const c = cleanField(v);
      if (c && !index.has(c)) {
        index.set(c, texts.length);
        texts.push(c);
      }
    }
  }
  const detections = texts.length ? await detect(texts) : [];
  const langOf = (clean: string) => detections[index.get(clean) ?? -1]?.lang ?? null;

  const candidates: Candidate[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const fieldNames = Object.keys(first.fields);
    const stats: FieldStats[] = fieldNames.map((name) => {
      // Only values with letters can be vocabulary (skips rank/frequency/number fields).
      const vals = group
        .map((s) => cleanField(s.fields[name] ?? ""))
        .filter((v) => /\p{L}/u.test(v));
      const n = vals.length;
      return {
        name,
        samples: n,
        targetShare: n ? vals.filter((v) => langOf(v) === targetLang).length / n : 0,
        glossShare: n ? vals.filter((v) => langOf(v) === glossLang).length / n : 0,
        avgTokens: n ? vals.reduce((a, v) => a + tokens(v), 0) / n : 0,
      };
    });

    const minSamples = Math.max(1, Math.floor(group.length / 2));
    const targetFields = stats.filter((f) => f.samples >= minSamples && f.targetShare >= 0.3);
    const wordScore = (f: FieldStats) =>
      f.targetShare + (WORD_NAME.test(f.name) ? 0.25 : 0) - Math.max(0, f.avgTokens - 3) * 0.1;
    const word = targetFields
      .filter((f) => f.avgTokens <= 4)
      .sort((a, b) => wordScore(b) - wordScore(a))[0];
    if (!word) continue;

    const sentence =
      targetFields
        .filter((f) => f.name !== word.name && f.avgTokens >= 4)
        .sort(
          (a, b) =>
            b.targetShare +
            (SENTENCE_NAME.test(b.name) ? 0.25 : 0) -
            (a.targetShare + (SENTENCE_NAME.test(a.name) ? 0.25 : 0)),
        )[0] ?? null;
    // A word gloss is short; sentence translations (ZinEN, English) detect as English more
    // confidently, so penalise length and prefer gloss-like field names.
    const glossScore = (f: FieldStats) =>
      f.glossShare + (GLOSS_NAME.test(f.name) ? 0.3 : 0) - Math.max(0, f.avgTokens - 4) * 0.15;
    // Single English words are also hard to identify, so a short, non-target field with a
    // gloss-like name qualifies even when language ID is unsure.
    const gloss =
      stats
        .filter(
          (f) =>
            f.name !== word.name &&
            f.name !== sentence?.name &&
            (f.glossShare >= 0.3 ||
              (GLOSS_NAME.test(f.name) &&
                f.targetShare < 0.3 &&
                f.avgTokens <= 6 &&
                f.samples >= minSamples)),
        )
        .sort((a, b) => glossScore(b) - glossScore(a))[0] ?? null;
    const confidence = Math.max(
      word.targetShare,
      sentence && sentence.targetShare >= 0.8 ? sentence.targetShare : 0,
    );

    candidates.push({
      deck: first.deck,
      modelName: first.modelName,
      noteCount: first.deckNoteCount,
      wordField: word.name,
      sentenceField: sentence?.name ?? null,
      glossField: gloss?.name ?? null,
      targetShare: word.targetShare,
      confidence,
      score: confidence * Math.log10(1 + first.deckNoteCount),
      fields: stats,
      examples: group.slice(0, 5).map((s) => cleanField(s.fields[word.name] ?? "")),
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Pick every candidate that holds target-language vocabulary. A deck passes on its own share,
 * or when its note type + word field pass on the share pooled across all decks using it
 * (single loanwords like "de supermarkt" can push one themed deck under the threshold).
 */
export function selectCandidates(candidates: Candidate[], minShare = 0.5): Candidate[] {
  const pooled = new Map<string, { share: number; weight: number }>();
  for (const c of candidates) {
    const k = `${c.modelName}\u0000${c.wordField}`;
    const w = c.fields.find((f) => f.name === c.wordField)?.samples ?? 0;
    const p = pooled.get(k) ?? { share: 0, weight: 0 };
    pooled.set(k, { share: p.share + c.confidence * w, weight: p.weight + w });
  }
  return candidates.filter((c) => {
    const p = pooled.get(`${c.modelName}\u0000${c.wordField}`);
    const pooledShare = p && p.weight ? p.share / p.weight : 0;
    return c.confidence >= minShare || pooledShare >= minShare;
  });
}
