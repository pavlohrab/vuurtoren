/**
 * Matching text tokens to learner-model keys (card headwords). A token matches a key by its
 * contextual lemma first, then its surface form (decks that list an inflected headword such as
 * "kinderen"), and only then by the analyzer's lower-trust alternative lemmas.
 */

export interface TokenLike {
  text: string;
  lemma: string;
  /** Other plausible lemmas from the analyzer (model vs dictionary). */
  alt_lemmas?: readonly string[];
}

/**
 * Key normalisation — MUST stay identical to server/nlp `normalize_key`:
 * NFKC, curly quotes/backtick → ', lowercase (not casefold: "ß" stays "ß"), trim.
 */
export function normalizeKey(s: string): string {
  return s.normalize("NFKC").replace(/[‘’`]/g, "'").toLowerCase().trim();
}

export type MatchVia = "lemma" | "surface" | "alt";

/** Candidate keys for a token in priority order: lemma, surface, alternative lemmas. */
export function tokenCandidates(t: TokenLike): { key: string; via: MatchVia }[] {
  const out: { key: string; via: MatchVia }[] = [];
  const seen = new Set<string>();
  const add = (raw: string, via: MatchVia) => {
    const key = normalizeKey(raw);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push({ key, via });
    }
  };
  add(t.lemma, "lemma");
  add(t.text, "surface");
  for (const a of t.alt_lemmas ?? []) add(a, "alt");
  return out;
}

export function tokenKeys(t: TokenLike): string[] {
  return tokenCandidates(t).map((c) => c.key);
}

type KeySet = ReadonlySet<string> | ReadonlyMap<string, unknown>;

/** First matching candidate with how it matched, or undefined. */
export function matchTokenDetailed(
  t: TokenLike,
  keys: KeySet,
): { key: string; via: MatchVia } | undefined {
  return tokenCandidates(t).find((c) => keys.has(c.key));
}

/** Key of the first matching candidate in `keys`, or undefined. */
export function matchToken(t: TokenLike, keys: KeySet): string | undefined {
  return matchTokenDetailed(t, keys)?.key;
}

/**
 * Does a tokenised sentence contain the term? Multiword terms must appear in order,
 * allowing up to `maxGap` tokens between consecutive parts ("op de hoogte", "te koop").
 * Backtracks, so an early partial match does not hide a later valid alignment.
 */
export function containsTerm(tokens: TokenLike[], key: string, maxGap = 3): boolean {
  const parts = normalizeKey(key).split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  const keysPerToken = tokens.map((t) => new Set(tokenKeys(t)));
  const at = (i: number, part: string) => keysPerToken[i]?.has(part) ?? false;
  const from = (partIndex: number, prev: number): boolean => {
    if (partIndex === parts.length) return true;
    const last = Math.min(tokens.length - 1, prev + 1 + maxGap);
    for (let j = prev + 1; j <= last; j++) {
      if (at(j, parts[partIndex]!) && from(partIndex + 1, j)) return true;
    }
    return false;
  };
  for (let start = 0; start < tokens.length; start++) {
    if (at(start, parts[0]!) && from(1, start)) return true;
  }
  return false;
}
