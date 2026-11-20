/**
 * Card templates in Anki's template language, rendered to HTML for the review screen:
 * `{{Field}}`, `{{#Field}}…{{/Field}}`, `{{^Field}}…{{/Field}}`, `{{FrontSide}}`,
 * `{{cloze:Field}}`, and the `text:`, `hint:` and `type:` filters. Sound tags become a list of
 * audio files. The HTML still has to be sanitised before it is shown (the web app does that).
 */
import { escapeHtml, stripHtml } from "./text.js";

export interface RenderedCard {
  html: string;
  /** Audio files named by `[sound:…]` tags, in order. */
  audio: string[];
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
const SOUND = /\[sound:([^\]]+)\]/g;

/** The cloze numbers used in a note's fields (`{{c1::…}}` → 1). */
export function clozeNumbers(fields: readonly string[]): number[] {
  const out = new Set<number>();
  for (const f of fields) for (const m of f.matchAll(CLOZE)) out.add(Number(m[1]));
  return [...out].filter((n) => n > 0).sort((a, b) => a - b);
}

/** One cloze field for card `n` (1-based), on the front (blanks) or the back (answers). */
function renderCloze(value: string, n: number, back: boolean): string {
  return value.replace(CLOZE, (_m, num: string, answer: string, hint?: string) => {
    if (Number(num) !== n) return answer;
    if (back) return `<span class="cloze">${answer}</span>`;
    return `<span class="cloze">[${hint ? escapeHtml(hint) : "…"}]</span>`;
  });
}

function applyFilters(
  value: string,
  filters: string[],
  ctx: { ord: number; back: boolean },
): string {
  let v = value;
  for (const f of filters.reverse()) {
    if (f === "text") v = escapeHtml(stripHtml(v));
    else if (f === "cloze") v = renderCloze(v, ctx.ord + 1, ctx.back);
    else if (f === "type") v = "";
    else if (f === "hint")
      v = v ? `<details class="hint"><summary>Hint</summary>${v}</details>` : "";
    // Other filters (furigana, kana, tts…) show the field as it is.
  }
  return v;
}

/**
 * Render one side of a card.
 * @param fields field name → value
 * @param ord template index (standard) or cloze number − 1 (cloze)
 * @param frontSide the rendered front, for `{{FrontSide}}` on the back
 */
export function renderTemplate(
  template: string,
  fields: Readonly<Record<string, string>>,
  ord: number,
  back: boolean,
  frontSide = "",
): RenderedCard {
  const has = (name: string) => stripHtml(fields[name] ?? "").trim() !== "";
  // Sections first (innermost last-defined first is enough for Anki's non-recursive use).
  let html = template;
  for (let guard = 0; guard < 20; guard++) {
    const next = html.replace(
      /\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g,
      (_m, kind: string, name: string, inner: string) => {
        const field = name.trim();
        const cloze = /^cloze:/.test(field);
        const key = field.replace(/^cloze:/, "");
        const shown = cloze ? new RegExp(`\\{\\{c${ord + 1}::`).test(fields[key] ?? "") : has(key);
        return (kind === "#") === shown ? inner : "";
      },
    );
    if (next === html) break;
    html = next;
  }
  html = html.replace(/\{\{([^#^/{}][^{}]*)\}\}/g, (_m, raw: string) => {
    const spec = raw.trim();
    if (spec === "FrontSide") return frontSide;
    const parts = spec.split(":");
    const name = parts.pop() ?? "";
    const value = fields[name.trim()];
    if (value === undefined) return "";
    return applyFilters(value, parts, { ord, back });
  });
  const audio: string[] = [];
  html = html.replace(SOUND, (_m, file: string) => {
    audio.push(file.trim());
    return "";
  });
  return { html, audio };
}
