/**
 * Matching text tokens to learner-model keys (card headwords). A token matches a key by its
 * contextual lemma first, then by its surface form — so both "liep" -> lopen and a deck that
 * lists an inflected form as headword ("kinderen") are covered.
 */

export interface TokenLike {
  text: string;
  lemma: string;
  /** Other plausible lemmas from the analyzer (model vs dictionary). */
  alt_lemmas?: readonly string[];
}

export function normalizeKey(s: string): string {
  return s.normalize("NFC").replace(/[‘’`]/g, "'").toLowerCase().trim();
}

/** Candidate keys for a token, in priority order: lemma, alternative lemmas, surface. */
export function tokenKeys(t: TokenLike): string[] {
  const keys = [t.lemma, ...(t.alt_lemmas ?? []), t.text].map(normalizeKey);
  return [...new Set(keys)];
}

/** Key of the first matching candidate in `keys`, or undefined. */
export function matchToken(
  t: TokenLike,
  keys: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): string | undefined {
  return tokenKeys(t).find((k) => keys.has(k));
}

/**
 * Does a tokenised sentence contain the term? Multiword terms must appear in order,
 * allowing up to `maxGap` tokens between parts ("op de hoogte", "te koop").
 */
export function containsTerm(tokens: TokenLike[], key: string, maxGap = 3): boolean {
  const parts = normalizeKey(key).split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  const keysPerToken = tokens.map(tokenKeys);
  const at = (i: number, part: string) => keysPerToken[i]?.includes(part) ?? false;
  for (let start = 0; start < tokens.length; start++) {
    if (!at(start, parts[0]!)) continue;
    let pos = start;
    let ok = true;
    for (const part of parts.slice(1)) {
      let found = -1;
      for (let j = pos + 1; j <= Math.min(tokens.length - 1, pos + 1 + maxGap); j++) {
        if (at(j, part)) {
          found = j;
          break;
        }
      }
      if (found < 0) {
        ok = false;
        break;
      }
      pos = found;
    }
    if (ok) return true;
  }
  return false;
}
