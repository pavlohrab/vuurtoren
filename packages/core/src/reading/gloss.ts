/**
 * A short meaning for inline glosses and cards. Dictionary senses often carry explanations
 * ("what (asking for a subject complement)", "to call; to telephone someone"); this keeps the
 * head word or phrase: brackets go, then everything after the first ";" or ":", then senses
 * longer than a few words give way to a shorter one.
 */

/** Longest gloss, in characters, before it is cut back. */
const MAX_CHARS = 32;
/** At most this many comma-separated alternatives ("also, too" rather than "also, too, moreover"). */
const MAX_ALTERNATIVES = 2;
/** A sense with more words than this counts as an explanation, not a translation. */
const MAX_WORDS = 4;

/** One sense reduced to its head: no brackets, nothing after ";" or ":". */
export function glossHead(sense: string): string {
  return clean(stripBrackets(sense).split(/[;:]/)[0]!);
}

const stripBrackets = (s: string) => s.replace(/\s*[([][^)\]]*[)\]]/g, "");
const clean = (s: string) =>
  s
    .replace(/^\s*(e\.g\.|i\.e\.)\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.,\s]+$/, "")
    .trim();
const words = (s: string) => s.split(" ").filter(Boolean).length;
const isShort = (s: string) => s !== "" && words(s) <= MAX_WORDS && s.length <= MAX_CHARS;

/**
 * The first short wording inside one sense: its parts before ":" and between ";" in order,
 * each whole or cut at its first comma. Null when every part is an explanation.
 */
function shortPart(sense: string): string | null {
  const [lead] = stripBrackets(sense).split(":");
  for (const raw of lead!.split(";")) {
    const part = clean(raw.split(",").slice(0, MAX_ALTERNATIVES).join(","));
    if (isShort(part)) return part;
    const cut = clean(part.split(",")[0]!);
    if (isShort(cut)) return cut;
  }
  return null;
}

/**
 * Up to `max` short meanings joined with ", ", in the dictionary's order of senses. When no
 * sense has a short wording, the first is cut back to fit.
 */
export function shortGloss(senses: readonly string[], max = 1): string {
  const out: string[] = [];
  for (const s of senses) {
    const part = shortPart(s);
    if (part && !out.includes(part)) out.push(part);
    if (out.length >= max) break;
  }
  if (out.length) return out.join(", ");
  const first = glossHead(senses[0] ?? "");
  return first.length <= MAX_CHARS ? first : `${first.slice(0, MAX_CHARS - 1).trimEnd()}…`;
}
