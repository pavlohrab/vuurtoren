/**
 * A small, safe Markdown renderer for the app's own content (grammar topic pages): paragraphs,
 * `-` and `1.` lists, `**bold**`, `_italic_` and `` `code` ``. It builds React elements (no
 * HTML strings), so nothing in the content can inject markup. Italic text in the topic pages is
 * Dutch, so it is marked `lang="nl"`.
 */
import type { ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|_[^_\s][^_]*_|`[^`]+`)/g;

/** Render inline Markdown (bold, italic, code) to React nodes. */
export function inline(text: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    // An underscore inside a word (snake_case) is not emphasis.
    const tok = m[0];
    if (tok.startsWith("_") && at > 0 && /[\p{L}\p{N}]/u.test(text[at - 1] ?? "")) continue;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}${at}`;
    if (tok.startsWith("**"))
      out.push(<strong key={k}>{inline(tok.slice(2, -2), `${k}-`)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else
      out.push(
        <em key={k} lang="nl">
          {inline(tok.slice(1, -1), `${k}-`)}
        </em>,
      );
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "h"; level: 3 | 4; text: string };

function blocks(md: string): Block[] {
  const out: Block[] = [];
  for (const chunk of md.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const first = lines[0]!.trim();
    const heading = /^(#{3,4})\s+(.+)$/.exec(first);
    if (heading) {
      out.push({ kind: "h", level: heading[1]!.length as 3 | 4, text: heading[2]! });
      continue;
    }
    const ul = /^[-*]\s+/;
    const ol = /^\d+[.)]\s+/;
    const kind = ul.test(first) ? "ul" : ol.test(first) ? "ol" : null;
    if (!kind) {
      out.push({ kind: "p", text: lines.map((l) => l.trim()).join(" ") });
      continue;
    }
    const marker = kind === "ul" ? ul : ol;
    const items: string[] = [];
    for (const l of lines) {
      if (marker.test(l.trim())) items.push(l.trim().replace(marker, ""));
      else if (items.length) items[items.length - 1] += ` ${l.trim()}`;
    }
    out.push({ kind, items });
  }
  return out;
}

/** Render a Markdown fragment as block elements. */
export function Markdown({ source }: { source: string }) {
  return (
    <>
      {blocks(source).map((b, i) => {
        if (b.kind === "p") return <p key={i}>{inline(b.text, `${i}-`)}</p>;
        if (b.kind === "h") {
          const H = b.level === 3 ? "h3" : "h4";
          return <H key={i}>{inline(b.text, `${i}-`)}</H>;
        }
        const L = b.kind;
        return (
          <L key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item, `${i}-${j}-`)}</li>
            ))}
          </L>
        );
      })}
    </>
  );
}
