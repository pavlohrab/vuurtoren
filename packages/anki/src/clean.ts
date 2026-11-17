/**
 * Turn raw Anki field HTML into plain text. Pure string code so it runs in any JS runtime
 * (web worker, extension service worker, Node) without a DOM.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Strip HTML, sound/media tags, cloze markup, furigana readings; collapse whitespace. */
export function cleanField(html: string): string {
  let s = html;
  s = s.replace(/\[sound:[^\]]*\]/g, " ");
  s = s.replace(/\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g, "$1");
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<rt>[\s\S]*?<\/rt>/gi, "");
  s = s.replace(/<br\s*\/?>|<\/(div|p|li)>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // Anki furigana syntax: 漢字[かんじ] (only after CJK characters, so "huis [n]" survives)
  s = s.replace(/([㐀-鿿豈-﫿])\[[^\]]*\]/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}

/** Bold/cloze-marked words in a sentence field: the card's target word on sentence cards. */
export function extractMarked(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<(b|strong|u)>([\s\S]*?)<\/\1>/gi))
    out.push(cleanField(m[2] ?? ""));
  for (const m of html.matchAll(/\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g))
    out.push(cleanField(m[1] ?? ""));
  return out.filter(Boolean);
}
