/**
 * Exercise recognition: an exercise block -> instruction, example, items and an exercise type,
 * using Dutch instruction keywords and item patterns (lemma hints in brackets, chunks separated
 * by gaps or "/", alternatives "is / zijn", pronoun rows). Answers are NOT filled here; gap-fills
 * get derived answers from `derive.ts` in the service layer. Pure.
 *
 * Scanned books lose things the recogniser must cope with: the printed line of a blank is often
 * not read at all ("Anne (wonen) in Nijmegen."), item numbers become garbage, and several
 * exercises can end up in one block when a header is damaged.
 */
import { hasBlank } from "./derive.js";
import type { Block, BookExercise, ExerciseItem, ExerciseType } from "./types.js";

/** A blank in OCR'd text: underscores (possibly spaced), dotted or dashed runs, an ellipsis. */
const BLANK_NORMALIZE = /_(?:[\s_]*_)+|…+|\.{4,}|-{4,}|—+|–{2,}/gu;
/** Marker that opens a numbered/lettered item: "1 ", "2.", "a)", "b ". */
const ITEM_MARKER = /^\s*(?:(?:\d{1,2}|[a-hA-H])[.)]?\s+(?=\S)|\d{1,2}(?=\p{Lu}))/u;
/** A lemma in brackets: one or two lowercase words (OCR may turn ")" into "]"). */
const HINT_SRC = String.raw`[(\[]\s*(\p{Ll}[\p{Ll}\s'’-]{2,24}?)\s*[)\]]`;
const HINT_ANY = new RegExp(HINT_SRC, "u");
const HINT_GLOBAL = new RegExp(HINT_SRC, "gu");
const PRONOUN_ROW =
  /^(ik|jij|je|u|hij|zij|ze|het|wij|we|jullie)(?:\s*\/\s*(?:jij|je|u|hij|zij|ze|het|we))*\b/i;

/** Normalise explicit blanks to `____` (a lone "_" before a bracket counts as a blank). */
function normalizeBlanks(s: string): string {
  return s.replace(BLANK_NORMALIZE, "____").replace(/(^|\s)_(?=\s*[([])/gu, "$1____");
}

/** Give a lemma hint without a visible blank one in front of it ("Willem (werken)" -> "Willem ____ (werken)"). */
function addImplicitBlanks(s: string): string {
  const t = normalizeBlanks(s).replace(
    HINT_GLOBAL,
    (m: string, _w: string, at: number, all: string) =>
      all.slice(0, at).trimEnd().endsWith("____") ? m : `____ ${m}`,
  );
  return t.replace(/\s{2,}/g, " ").trim();
}

const RULES: { type: ExerciseType; re: RegExp }[] = [
  {
    type: "sentence-building",
    re: /\b(maak|schrijf|vorm)\s+(\w+\s+)?(zinnen|zin)\b|woordvolgorde|(goede|juiste) volgorde|\b(put the words in (the right |the correct )?order|make sentences|build sentences|bilden sie sätze|ordnen sie|remettez .* dans l'ordre|ordena las palabras)\b/iu,
  },
  {
    type: "conjugation-table",
    re: /\b(schema|tabel|complete the table|ergänzen sie die tabelle)\b/iu,
  },
  {
    type: "matching",
    re: /\b(combineer|verbind|koppel|welke .* hoort bij|trek een lijn|wat hoort bij|maak combinaties|match|connect|ordnen sie zu|verbinden sie|was passt zusammen|associez|relaciona|une)\b/iu,
  },
  {
    type: "choice",
    re: /\b(kies|omcirkel|kruis aan|wat is goed|welk(e)? (woord|antwoord|zin|titel)|ja of nee|waar of niet waar|juist of onjuist|choose|circle|tick|true or false|kreuzen sie an|richtig oder falsch|wählen sie|choisissez|cochez|vrai ou faux|elige|verdadero o falso)\b/iu,
  },
  {
    type: "gapfill",
    re: /\b(vul|vu|aanvullen|invullen|fill in|complete the (sentences|text|gaps)|ergänzen sie|füllen sie|complétez|completa)\b/iu,
  },
  {
    type: "open-task",
    re: /\b(werk in (groepjes|drietallen|tweetallen|tweetal|paren)|schrijf|vertel|spreek|bespreek|beschrijf|vraag|interview|praat|geef (kort )?antwoord|beantwoord|maak een (gesprek|dialoog|afspraak|woordweb)|speel|leg uit|woordweb|write|talk|discuss|describe|answer the questions|schreiben sie|sprechen sie|erzählen sie|écrivez|parlez|escribe|habla)\b/iu,
  },
  { type: "listening", re: /\b(luister|listen|hören sie|écoutez|escucha)\b/iu },
];

/** Type from the instruction alone (null when no keyword matches). */
function typeFromInstruction(instruction: string): ExerciseType | null {
  return RULES.find((r) => r.re.test(instruction))?.type ?? null;
}

interface Parts {
  instruction: string;
  example?: string;
  items: string[];
}

const isItemStart = (l: string) => ITEM_MARKER.test(l);
/** A line without a single word of three letters: an icon or a stray mark the OCR read. */
const isJunkLine = (l: string) => !/\p{L}{3}/u.test(l);
const endsSentence = (l: string) => /[.?!:]["”’')\]]?\s*$/.test(l);

/** Split a block's lines into instruction, example and raw item strings. */
function splitExercise(text: string): Parts {
  const lines = text.split("\n").map((l) => l.trim());
  let i = 0;
  // Blank lines and OCR junk before the instruction (icons read as "k", "0 N n n p n").
  while (i < lines.length && (!lines[i] || isJunkLine(lines[i] ?? ""))) i++;
  // Instruction: the first line, and following lines while it has not ended with . ? : or !.
  const instr: string[] = [];
  while (i < lines.length && lines[i]) {
    const l = lines[i] ?? "";
    if (instr.length > 0 && (isItemStart(l) || /^voorbeeld/i.test(l) || hasBlank(l))) break;
    instr.push(l);
    i++;
    if (endsSentence(l)) break;
  }
  const rest = lines.slice(i);
  let example: string | undefined;
  const exAt = rest.findIndex((l) => /^voorbeeld/i.test(l));
  let items = rest;
  if (exAt >= 0) {
    // The example runs to the next blank line or item marker.
    let end = exAt + 1;
    while (end < rest.length && rest[end] && !isItemStart(rest[end] ?? "")) end++;
    example = rest
      .slice(exAt, end)
      .join(" ")
      .replace(/^voorbeeld\s*:?\s*/i, "")
      .trim();
    items = [...rest.slice(0, exAt), ...rest.slice(end)];
  }
  const parts: Parts = { instruction: instr.join(" ").trim(), items: groupItems(items) };
  if (example) parts.example = normalizeBlanks(example);
  return parts;
}

/**
 * Group lines into items. A line opens a new item when it has an item marker, or when the
 * previous item is already a finished sentence; otherwise it continues the previous item.
 */
function groupItems(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const marked = isItemStart(line);
    const prev = out[out.length - 1];
    if (marked || prev === undefined || endsSentence(prev)) {
      out.push(line.replace(ITEM_MARKER, "").trim());
    } else {
      out[out.length - 1] = `${prev} ${line}`;
    }
  }
  return out.filter((l) => /\p{L}{2}/u.test(l));
}

/** Lemma hints of a gap-fill sentence (after blanks were inserted). */
function hintsOf(prompt: string): string[] {
  return [...prompt.matchAll(new RegExp(`____\\s*${HINT_SRC}`, "gu"))].map((m) =>
    (m[1] ?? "").trim(),
  );
}

function gapfillItem(raw: string): ExerciseItem {
  const prompt = addImplicitBlanks(raw);
  const hints = hintsOf(prompt);
  const item: ExerciseItem = {
    prompt,
    answerSource: hints.length ? "derived" : "user",
    confidence: 0,
  };
  if (hints.length) item.hint = hints.join("|");
  return item;
}

/** "Willen / Zullen jullie ..." -> options [Willen, Zullen] and a prompt with a blank. */
const ALT_RE = /(\p{L}+)\s+\/\s+(\p{L}+)(?:\s+\/\s+(\p{L}+))?/u;

function choiceItem(raw: string): ExerciseItem {
  const alt = ALT_RE.exec(raw);
  if (alt) {
    const options = alt.slice(1).filter((o): o is string => !!o);
    return {
      prompt: raw.replace(alt[0], "____"),
      options,
      answerSource: "user",
      confidence: 0,
    };
  }
  const bracket = /[([]\s*([^()[\]]{2,60}?(?:\s*\/\s*[^()[\]]{1,30}){1,3})\s*[)\]]/u.exec(raw);
  const options = bracket?.[1]
    ?.split("/")
    .map((o) => o.trim())
    .filter(Boolean);
  const item: ExerciseItem = { prompt: normalizeBlanks(raw), answerSource: "user", confidence: 0 };
  if (options && options.length >= 2) item.options = options;
  return item;
}

/** Chunks of a word-order item: separated by gaps ("____"), " / " or " - ". */
function chunksOf(raw: string): string[] {
  return normalizeBlanks(raw)
    .split(/\s*(?:____|\s\/\s|\s[–—-]\s)\s*/u)
    .map((c) => c.trim())
    .filter((c) => /\p{L}/u.test(c));
}

function chunkItem(raw: string, beginWithCapital: boolean): ExerciseItem {
  const chunks = chunksOf(raw);
  const item: ExerciseItem = {
    prompt: chunks.join(" / "),
    chunks,
    answerSource: "user",
    confidence: 0,
  };
  if (beginWithCapital) {
    const caps = chunks.filter((c) => /^\p{Lu}/u.test(c));
    if (caps.length === 1 && caps[0]) item.first = caps[0];
  }
  return item;
}

const PERSONS = ["ik", "jij", "hij", "wij", "jullie", "zij"] as const;

/** Verbs of a conjugation table: the infinitives on the "infinitief" header line. */
function tableVerbs(lines: readonly string[]): string[] {
  const header = lines.find((l) => /^infinitief\b/i.test(l));
  if (!header) return [];
  return (header.match(/\p{L}{4,}/gu) ?? [])
    .map((w) => w.toLowerCase())
    .filter((w) => w !== "infinitief" && /(en|n)$/.test(w));
}

/** One gap per (person, verb); the persons are the fixed six of a Dutch conjugation table. */
function tableItems(lines: readonly string[]): ExerciseItem[] {
  return tableVerbs(lines).flatMap((v) =>
    PERSONS.map((p) => ({
      prompt: `${p} ____ (${v})`,
      hint: v,
      person: p,
      answerSource: "derived" as const,
      confidence: 0,
      tense: "present" as const,
    })),
  );
}

const hasHint = (s: string) => HINT_ANY.test(s);

/**
 * An answer option line of a multiple-choice question: "a Ja.", "b) Nee", with the tick box the
 * OCR reads as "[ |", "L |", "|" or "[]" in front, and "c" often read as "«".
 */
const OPTION_RE = /^(?:[[(|L]?\s*[|\]]?\s*|\[\]\s*)?([a-fA-F]|«)[.)]?\s+(\S.*)$/u;

function optionOf(line: string): string | null {
  const m = OPTION_RE.exec(line.trim());
  return m?.[2] && /\p{L}{2}/u.test(m[2]) ? m[2].trim() : null;
}

/**
 * Multiple-choice questions in a block: a question line ("1 Waarom gaat Anne ...?") followed by
 * at least two option lines. Questions about a text and "Kies het goede antwoord" look like this
 * in most textbooks. The book's answer key is not known, so the items have no answer.
 */
function choiceQuestions(text: string): ExerciseItem[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ExerciseItem[] = [];
  let current: { prompt: string; options: string[] } | null = null;
  const close = () => {
    if (current && current.options.length >= 2) {
      out.push({
        prompt: current.prompt,
        options: current.options,
        answerSource: "user",
        confidence: 0,
      });
    }
    current = null;
  };
  for (const line of lines) {
    const option = current ? optionOf(line) : null;
    if (current && option) {
      current.options.push(option);
      continue;
    }
    if (current && current.options.length > 0 && !isItemStart(line) && !/\?$/.test(line)) {
      // A wrapped option line.
      const last = current.options.length - 1;
      current.options[last] = `${current.options[last]} ${line}`;
      continue;
    }
    if (/\?\s*$/.test(line) && /\p{L}{3}/u.test(line)) {
      close();
      current = { prompt: line.replace(ITEM_MARKER, "").trim(), options: [] };
    } else if (!current || current.options.length > 0) {
      close();
    }
  }
  close();
  return out;
}

/** Decide the type from instruction + item shapes. */
function classify(instruction: string, items: readonly string[], block = ""): ExerciseType {
  const fromText = typeFromInstruction(instruction);
  const hinted = items.filter(hasHint);
  const chunked = items.filter((i) => chunksOf(i).length >= 3);
  if (fromText === "sentence-building" && chunked.length >= 2) return "sentence-building";
  if (
    fromText === "conjugation-table" &&
    (/^infinitief\b/im.test(block) || items.filter((i) => PRONOUN_ROW.test(i)).length >= 3)
  ) {
    return "conjugation-table";
  }
  if (fromText === "choice" || fromText === "matching") {
    // "Kies ... Vul ... in" with lemma hints is a gap-fill over a word bank.
    return hinted.length >= 2 &&
      fromText === "choice" &&
      items.some((i) => ALT_RE.test(i)) === false
      ? "gapfill"
      : fromText;
  }
  if (hinted.length >= 2 && hinted.length >= items.length / 2 && fromText !== "open-task") {
    return "gapfill";
  }
  if (fromText === "gapfill" && items.filter(hasBlank).length >= 2) return "gapfill";
  if (
    fromText &&
    fromText !== "gapfill" &&
    fromText !== "sentence-building" &&
    fromText !== "conjugation-table"
  ) {
    return fromText;
  }
  return "unknown";
}

/**
 * Recognise one exercise block.
 * @returns the exercise with unanswered items (`confidence` 0; run `derive.ts` for gap-fills)
 */
export function recognizeExercise(block: Block): BookExercise {
  const { instruction, example, items: raw } = splitExercise(block.text);
  const lines = block.text.split("\n").map((l) => l.trim());
  // The task is often a line or two below a situation sentence ("Het is half zes. ...").
  const taskLine =
    typeFromInstruction(instruction) !== null
      ? instruction
      : (lines.slice(0, 10).find((l) => typeFromInstruction(l) !== null) ?? instruction);
  const questions = choiceQuestions(block.text);
  if (questions.length >= 2) {
    const ex: BookExercise = {
      number: block.number ?? 0,
      page: block.page,
      instruction: taskLine === instruction ? instruction : `${instruction} ${taskLine}`.trim(),
      type: "choice",
      items: questions,
      raw: normalizeBlanks(block.text),
    };
    if (example) ex.example = example;
    return ex;
  }
  const type = classify(taskLine, raw, block.text);
  let items: ExerciseItem[];
  switch (type) {
    case "gapfill":
      items = raw.filter((i) => hasBlank(i) || hasHint(i)).map(gapfillItem);
      break;
    case "sentence-building": {
      const capital = /hoofdletter/i.test(instruction);
      items = raw.filter((i) => chunksOf(i).length >= 3).map((i) => chunkItem(i, capital));
      break;
    }
    case "conjugation-table":
      items = tableItems(lines);
      break;
    case "choice":
      items = raw
        .filter((i) => ALT_RE.test(i) || /[([][^)\]]*\/[^)\]]*[)\]]/.test(i))
        .map(choiceItem);
      break;
    default:
      items = [];
  }
  const ex: BookExercise = {
    number: block.number ?? 0,
    page: block.page,
    instruction: taskLine === instruction ? instruction : `${instruction} ${taskLine}`.trim(),
    type:
      items.length === 0 &&
      ["gapfill", "sentence-building", "conjugation-table", "choice"].includes(type)
        ? "unknown"
        : type,
    items,
    raw: normalizeBlanks(block.text),
  };
  if (example) ex.example = example;
  return ex;
}

/** Recognise all exercise blocks of a list of blocks. */
export function recognizeExercises(blocks: readonly Block[]): BookExercise[] {
  return blocks.filter((b) => b.kind === "exercise").map(recognizeExercise);
}
