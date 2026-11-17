import {
  type CardMemory,
  type WordKnowledge,
  type WordState,
  classifyCard,
  mergeKnowledge,
} from "./memory.js";

/** One Anki-derived observation: a normalised lemma key and the memory of a card teaching it. */
export interface KnowledgeEvidence {
  key: string;
  memory: CardMemory;
}

export type LearnerModel = Map<string, WordKnowledge>;

/** Build lemma -> knowledge, keeping the strongest evidence per lemma (AnkiMorphs-style max). */
export function buildLearnerModel(
  evidence: Iterable<KnowledgeEvidence>,
  nowMs: number = Date.now(),
): LearnerModel {
  const model: LearnerModel = new Map();
  for (const { key, memory } of evidence) {
    if (!key) continue;
    model.set(key, mergeKnowledge(model.get(key), classifyCard(memory, nowMs)));
  }
  return model;
}

export function summarizeModel(model: LearnerModel): Record<WordState, number> {
  const counts: Record<WordState, number> = {
    unknown: 0,
    seen: 0,
    learning: 0,
    known: 0,
    ignored: 0,
  };
  for (const k of model.values()) counts[k.state]++;
  return counts;
}
