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
export function normalizeBlanks(s: string): string {
  return s.replace(BLANK_NORMALIZE, "____").replace(/(^|\s)_(?=\s*[([])/gu, "$1____");
}

/** Give a lemma hint without a visible blank one in front of it ("Willem (werken)" -> "Willem ____ (werken)"). */
export function addImplicitBlanks(s: string): string {
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
    re: /\b(maak|schrijf|vorm)\s+(\w+\s+)?(zinnen|zin)\b|woordvolgorde|(goede|juiste) volgorde/i,
  },
  { type: "conjugation-table", re: /\b(schema|tabel)\b/i },
  {
    type: "matching",
    re: /\b(combineer|verbind|koppel|welke .* hoort bij|trek een lijn|wat hoort bij)\b/i,
  },
  {
    type: "choice",
    re: /\b(kies|omcirkel|wat is goed|welk(e)? (woord|antwoord|zin)|ja of nee|waar of niet waar|juist of onjuist)\b/i,
  },
  { type: "gapfill", re: /\b(vul|aanvullen|invullen)\b/i },
  {
    type: "open-task",
    re: /\b(werk in (groepjes|drietallen|tweetallen|tweetal|paren)|schrijf|vertel|spreek|bespreek|beschrijf|vraag|interview|praat|geef (kort )?antwoord|beantwoord|maak een (gesprek|dialoog|afspraak|woordweb)|speel|leg uit|woordweb)\b/i,
  },
  { type: "listening", re: /\bluister\b/i },
];

/** Type from the instruction alone (null when no keyword matches). */
export function typeFromInstruction(instruction: string): ExerciseType | null {
  return RULES.find((r) => r.re.test(instruction))?.type ?? null;
}

interface Parts {
  instruction: string;
  example?: string;
  items: string[];
}

const isItemStart = (l: string) => ITEM_MARKER.test(l);
const endsSentence = (l: string) => /[.?!:]["”’')\]]?\s*$/.test(l);

/** Split a block's lines into instruction, example and raw item strings. */
export function splitExercise(text: string): Parts {
  const lines = text.split("\n").map((l) => l.trim());
  let i = 0;
  while (i < lines.length && !lines[i]) i++;
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
export function groupItems(lines: readonly string[]): string[] {
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

/** Decide the type from instruction + item shapes. */
export function classify(instruction: string, items: readonly string[], block = ""): ExerciseType {
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
  const type = classify(instruction, raw, block.text);
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
    instruction,
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
