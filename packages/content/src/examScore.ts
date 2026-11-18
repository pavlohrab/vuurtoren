/**
 * Access to the exam banks and the pure scoring rules of practice and mock exams.
 */
import { BANKS } from "./generated/exam.js";
import type {
  ExamBank,
  ExamPart,
  KnmTheme,
  ListeningFragment,
  McQuestion,
  ReadingText,
  Vocab,
} from "./exam.js";
import { examPartInfo } from "./examInfo.js";

/** The bank of an exam (default: the A2 inburgeringsexamen). */
export function examBank(id = "nl-a2"): ExamBank {
  const bank = BANKS.find((b) => b.id === id);
  if (!bank) throw new Error(`unknown exam ${id}`);
  return bank;
}

/** KNM questions per theme in one mock exam (8 themes x 5 = 40, as in the real exam). */
export const KNM_PER_THEME = 5;

/** A group of questions that share one stimulus (a text, a fragment, a KNM theme). */
export type McGroup =
  | { kind: "text"; item: ReadingText }
  | { kind: "fragment"; item: ListeningFragment }
  | { kind: "knm"; theme: KnmTheme; questions: McQuestion[] };

/** Mock exam numbers of a part (1, 2, …). */
export function examSets(part: ExamPart, bank = examBank()): number[] {
  const sets = new Set<number>();
  if (part === "lezen") bank.lezen.forEach((t) => sets.add(t.set));
  else if (part === "luisteren") bank.luisteren.forEach((f) => sets.add(f.set));
  else if (part === "schrijven") bank.schrijven.tasks.forEach((t) => sets.add(t.set));
  else if (part === "spreken") bank.spreken.prompts.forEach((p) => sets.add(p.set));
  else {
    const fewest = Math.min(...bank.knm.map((t) => t.questions.length));
    for (let s = 1; s * KNM_PER_THEME <= fewest; s++) sets.add(s);
  }
  return [...sets].sort((a, b) => a - b);
}

/**
 * The question groups of one multiple-choice set: a mock exam (`set` = 1, 2, …) or, for KNM,
 * one theme's whole bank (`theme`).
 */
export function mcGroups(
  part: "lezen" | "luisteren" | "knm",
  pick: { set: number } | { theme: string },
  bank = examBank(),
): McGroup[] {
  if (part === "lezen") {
    if (!("set" in pick)) return [];
    return bank.lezen.filter((t) => t.set === pick.set).map((item) => ({ kind: "text", item }));
  }
  if (part === "luisteren") {
    if (!("set" in pick)) return [];
    return bank.luisteren
      .filter((f) => f.set === pick.set)
      .map((item) => ({ kind: "fragment", item }));
  }
  if ("theme" in pick) {
    const theme = bank.knm.find((t) => t.id === pick.theme);
    return theme ? [{ kind: "knm", theme, questions: theme.questions }] : [];
  }
  const from = (pick.set - 1) * KNM_PER_THEME;
  return bank.knm.map((theme) => ({
    kind: "knm",
    theme,
    questions: theme.questions.slice(from, from + KNM_PER_THEME),
  }));
}

/** The questions of some groups, in order. */
export function groupQuestions(groups: readonly McGroup[]): McQuestion[] {
  return groups.flatMap((g) => (g.kind === "knm" ? g.questions : g.item.questions));
}

/** Points needed to pass `total` items with an estimated pass share. */
export function passMark(total: number, share: number): number {
  return Math.ceil(total * share - 1e-9);
}

export interface Score {
  correct: number;
  total: number;
  /** correct / total (0 when there are no items). */
  ratio: number;
  /** Estimated points needed to pass. */
  passMark: number;
  passed: boolean;
}

function score(correct: number, total: number, share: number): Score {
  const mark = passMark(total, share);
  return {
    correct,
    total,
    ratio: total ? correct / total : 0,
    passMark: mark,
    passed: total > 0 && correct >= mark,
  };
}

/** Score multiple-choice answers (question id -> chosen option; missing = unanswered). */
export function scoreMc(
  part: ExamPart,
  questions: readonly McQuestion[],
  answers: Readonly<Record<string, number | undefined>>,
): Score & { wrong: string[] } {
  const wrong = questions.filter((q) => answers[q.id] !== q.answer).map((q) => q.id);
  return {
    ...score(questions.length - wrong.length, questions.length, examPartInfo(part).passEstimate),
    wrong,
  };
}

/** Score a self-check (or AI) rubric: ticked items out of all items. */
export function scoreRubric(part: ExamPart, ticked: number, total: number): Score {
  return score(Math.min(ticked, total), total, examPartInfo(part).passEstimate);
}

/** Words in a free-writing answer. */
export function countAnswerWords(text: string): number {
  return text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
}

/**
 * The words worth learning from the items whose questions were answered wrongly: the vocab of
 * every text or fragment with at least one wrong question, first occurrence wins.
 */
export function missedVocab(
  groups: readonly McGroup[],
  wrongIds: readonly string[],
): { lemma: string; en: string }[] {
  const wrong = new Set(wrongIds);
  const out = new Map<string, string>();
  for (const g of groups) {
    if (g.kind === "knm") continue;
    if (!g.item.questions.some((q) => wrong.has(q.id))) continue;
    for (const [lemma, en] of Object.entries(g.item.vocab as Vocab)) {
      if (!out.has(lemma)) out.set(lemma, en);
    }
  }
  return [...out].map(([lemma, en]) => ({ lemma, en }));
}

/**
 * A stable shuffled order of a question's options (indices into `options`), so the right answer
 * is not always in the same place. Same `seed` + question id = same order.
 */
export function optionOrder(q: Pick<McQuestion, "id" | "options">, seed: string): number[] {
  let h = 2166136261;
  for (const ch of `${seed}:${q.id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}
