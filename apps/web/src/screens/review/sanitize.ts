/**
 * Card HTML from Anki templates, made safe to show: an allow-list of formatting tags and
 * attributes. Scripts, styles, frames, forms, event handlers and links out are removed; images
 * keep only sources that are the card's own media (given as object URLs).
 */

const ALLOWED = new Set([
  "a",
  "b",
  "br",
  "div",
  "em",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "ruby",
  "rt",
  "rp",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "blockquote",
  "code",
  "pre",
  "font",
  "h1",
  "h2",
  "h3",
  "h4",
  "details",
  "summary",
]);
/** Elements dropped with everything inside them. */
const DROPPED = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "link",
  "meta",
  "base",
  "svg",
  "math",
  "template",
  "audio",
  "video",
  "source",
  "noscript",
  "frame",
  "frameset",
]);
const ATTRS = new Set(["class", "colspan", "rowspan", "title", "alt", "id"]);

/**
 * @param html card HTML
 * @param media media file name → object URL; other image sources are removed
 */
export function sanitizeCardHtml(
  html: string,
  media: Readonly<Record<string, string>> = {},
): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const clean = (el: Element): void => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (DROPPED.has(tag)) {
        child.remove();
        continue;
      }
      if (!ALLOWED.has(tag)) {
        // Keep the text, drop the element.
        clean(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      const src = tag === "img" ? child.getAttribute("src") : null;
      for (const a of [...child.attributes]) {
        if (!ATTRS.has(a.name.toLowerCase())) child.removeAttribute(a.name);
      }
      if (tag === "img") {
        const url = src ? (media[decodeURIComponent(src)] ?? media[src]) : undefined;
        if (url) child.setAttribute("src", url);
        else child.remove();
      }
      clean(child);
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
