/**
 * Turn raw Anki field HTML into plain text. Pure string code so it runs in any JS runtime
 * (web worker, extension service worker, Node) without a DOM.
 */

// Latin-1 named entities in code-point order (U+00A0..U+00FF), as Anki's editor emits them.
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(
    " ",
  );

const ENTITIES: Record<string, string> = {
  ...Object.fromEntries(LATIN1.map((name, i) => [name, String.fromCodePoint(0xa0 + i)])),
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  OElig: "\u0152",
  oelig: "\u0153",
  Scaron: "\u0160",
  scaron: "\u0161",
  Yuml: "\u0178",
  fnof: "\u0192",
  circ: "\u02c6",
  tilde: "\u02dc",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  zwnj: "\u200c",
  zwj: "\u200d",
  lrm: "\u200e",
  rlm: "\u200f",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201a",
  ldquo: "\u201c",
  rdquo: "\u201d",
  bdquo: "\u201e",
  dagger: "\u2020",
  Dagger: "\u2021",
  bull: "\u2022",
  hellip: "\u2026",
  permil: "\u2030",
  prime: "\u2032",
  Prime: "\u2033",
  lsaquo: "\u2039",
  rsaquo: "\u203a",
  euro: "\u20ac",
  trade: "\u2122",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      // invalid / out-of-range code points stay as written instead of throwing
      return Number.isInteger(code) &&
        code > 0 &&
        code <= 0x10ffff &&
        (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : m;
    }
    // names are case-sensitive (Eacute ≠ eacute); fall back to lowercase for AMP, NBSP, …
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Strip HTML, sound/media tags, cloze markup, furigana readings; collapse whitespace. */
export function cleanField(html: string): string {
  let s = html;
  s = s.replace(/\[sound:[^\]]*\]/g, " ");
  s = s.replace(/\{\{c\d+::([\s\S]*?)(?:::[^}]*)?\}\}/g, "$1");
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<rt>[\s\S]*?<\/rt>/gi, "");
  // block-level tags (opening and closing) separate words: "lopen<div>liep</div>"
  s = s.replace(/<br\s*\/?>|<\/?(div|p|li|ul|ol|tr|td|th|table|h[1-6]|blockquote)\b[^>]*>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // Anki furigana syntax: 漢字[かんじ] (only after CJK characters, so "huis [n]" survives)
  s = s.replace(/([㐀-鿿豈-﫿])\[[^\]]*\]/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}

/** Bold/cloze-marked words in a sentence field: the card's target word on sentence cards. */
export function extractMarked(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<(b|strong|u)\b[^>]*>([\s\S]*?)<\/\1>/gi))
    out.push(cleanField(m[2] ?? ""));
  for (const m of html.matchAll(/\{\{c\d+::([\s\S]*?)(?:::[^}]*)?\}\}/g))
    out.push(cleanField(m[1] ?? ""));
  return out.filter(Boolean);
}
