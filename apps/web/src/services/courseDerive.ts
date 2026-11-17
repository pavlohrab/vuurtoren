/**
 * Derived answers for recognised gap-fill items: one batched parse (/analyze) and one batched
 * morphology lookup (/forms) for a whole course, then the pure rules of @app/core.
 * Items the user corrected keep their answer (`answerSource: "user"`).
 */
import {
  type BookExercise,
  type ExerciseItem,
  type ParseToken,
  type SubjectGuess,
  type WordForms,
  deriveGapAnswer,
  subjectByRules,
  subjectFromParse,
} from "@app/core";

/** The slice of NlpClient this needs (a fake in tests). */
export interface DeriveClient {
  forms(lang: "nl", lemmas: { lemma: string; pos: string }[]): Promise<Record<string, WordForms>>;
  analyzeText(lang: "nl", texts: string[]): Promise<{ tokens: ParseToken[] }[]>;
}

const BLANK = /_{2,}/;
const BLANK_G = /_{2,}(?:\s*[([][^)\]]*[)\]])?/g;

/** One blank of an item with the context the rules need. */
interface Slot {
  hint: string;
  before: string;
  after: string;
  /** Sentence with this blank filled by its lemma (and the others by theirs), for the parser. */
  placeholder: string;
  offset: number;
}

/** Split a gap-fill prompt into its blanks (each with its "(hint)"). */
export function slotsOf(item: ExerciseItem): Slot[] | null {
  const hints = (item.hint ?? "").split("|").filter(Boolean);
  const pieces = item.prompt.split(BLANK_G);
  const blanks = pieces.length - 1;
  if (blanks < 1 || hints.length !== blanks) return null;
  return hints.map((hint, k) => {
    const before = pieces.slice(0, k + 1).join(" … ");
    const after = pieces.slice(k + 1).join(" … ");
    let text = "";
    let offset = 0;
    pieces.forEach((piece, i) => {
      text += piece;
      if (i < blanks) {
        if (i === k) offset = text.length;
        text += hints[i];
      }
    });
    return { hint, before, after, placeholder: text, offset };
  });
}

/**
 * Fill derived answers into every gap-fill / conjugation item that has no book or user answer.
 * @returns new exercises (inputs are not mutated)
 */
export async function deriveAnswers(
  exercises: readonly BookExercise[],
  client: DeriveClient,
): Promise<BookExercise[]> {
  const wanted: { ex: number; item: number; slots: Slot[] }[] = [];
  exercises.forEach((e, ex) => {
    if (e.type !== "gapfill" && e.type !== "conjugation-table") return;
    e.items.forEach((it, item) => {
      if (it.answerSource === "user" || it.answerSource === "book") return;
      const slots = BLANK.test(it.prompt) ? slotsOf(it) : null;
      if (slots) wanted.push({ ex, item, slots });
    });
  });
  if (wanted.length === 0) return exercises.map((e) => ({ ...e }));

  const lemmas = [...new Set(wanted.flatMap((w) => w.slots.map((s) => s.hint)))];
  const forms = await client.forms(
    "nl",
    lemmas.map((lemma) => ({ lemma, pos: "VERB" })),
  );
  const texts = [...new Set(wanted.flatMap((w) => w.slots.map((s) => s.placeholder)))];
  const parsed = new Map<string, ParseToken[]>();
  try {
    const result = await client.analyzeText("nl", texts);
    texts.forEach((t, i) => parsed.set(t, result[i]?.tokens ?? []));
  } catch {
    // Without a parse the rules still work (lower confidence for noun subjects).
  }

  const out = exercises.map((e) => ({ ...e, items: [...e.items] }));
  for (const { ex, item, slots } of wanted) {
    const exercise = out[ex];
    const it = exercise?.items[item];
    if (!exercise || !it) continue;
    const answers: string[] = [];
    let confidence = 1;
    let tense: ExerciseItem["tense"];
    let accept: string | undefined;
    for (const slot of slots) {
      const tokens = parsed.get(slot.placeholder);
      const subject: SubjectGuess | null =
        (tokens ? subjectFromParse(tokens, slot.offset) : null) ??
        subjectByRules(slot.before, slot.after);
      const d = deriveGapAnswer({
        instruction: exercise.instruction,
        before: slot.before,
        after: slot.after,
        hint: slot.hint,
        forms: forms[slot.hint],
        subject,
      });
      if (!d.answer) {
        answers.length = 0;
        confidence = 0;
        break;
      }
      answers.push(d.answer);
      confidence = Math.min(confidence, d.confidence);
      tense ??= d.tense === "infinitive" ? undefined : d.tense;
      if (slots.length === 1 && d.accept?.[0]) accept = d.accept[0];
    }
    const next: ExerciseItem = { ...it, confidence, answerSource: "derived" };
    delete next.answer;
    delete next.accept;
    if (answers.length > 0) next.answer = answers.join("|");
    if (accept) next.accept = [accept];
    if (tense) next.tense = tense;
    exercise.items[item] = next;
  }
  return out;
}
