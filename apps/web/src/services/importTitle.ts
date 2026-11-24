/**
 * The title of an imported text. PDFs often carry junk in their Title metadata ("untitled",
 * "Microsoft Word - brief.docx", "Document1"), and web pages end theirs with the site's name
 * ("Vuurtoren - Wikipedia", "Kabinet valt | NOS"). A text should be called by what it is.
 */

/** Metadata titles that name the file or the tool, not the text. */
const JUNK_TITLE =
  /^(?:untitled|naamloos|title|titel|document\s*\d*|doc\s*\d*|microsoft\s+(?:word|powerpoint|excel)\b.*|scan\w*\s*\d*|img[_-]?\d+.*|.+\.(?:docx?|odt|pdf|pages|rtf|txt|indd|pptx?))$/i;

/** A PDF's Title metadata when it is a real title, else null. */
export function usefulMetaTitle(title: string | null | undefined): string | null {
  const t = (title ?? "").trim();
  if (t.length < 3 || t.length > 120 || JUNK_TITLE.test(t)) return null;
  return t;
}

/** The text's own heading: a short first line without a full stop, else null. */
export function headingOf(content: string): string | null {
  const first = content.trim().split(/\n/)[0]?.trim() ?? "";
  if (!first || first.length > 80 || /[.!?…:;,]$/.test(first)) return null;
  // A heading is followed by more text; a one-line text has no heading.
  return content.trim().length > first.length + 20 ? first : null;
}

/** A file name as a title: "de_trein-naar_Amsterdam.pdf" → "de trein naar Amsterdam". */
export function fileTitle(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The title of a PDF: its real metadata title, else its heading, else its file name. */
export function pdfTitle(meta: string | null | undefined, content: string, file: string): string {
  return usefulMetaTitle(meta) ?? headingOf(content) ?? fileTitle(file);
}

/**
 * A web page's title without the site's name at the end, when that name is the page's own site
 * ("… - Wikipedia", "… | NOS" on nos.nl). Other endings stay ("Koken - een recept").
 */
export function pageTitle(title: string, url: string): string {
  const m = /^(.{3,}?)\s+[-–—|·•:]\s+([^-–—|·•]{2,40})$/u.exec(title.trim());
  if (!m) return title.trim();
  const [, rest, site] = m as unknown as [string, string, string];
  const flat = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // No usable address: only the well-known endings below.
  }
  const core = flat(host.split(".").slice(0, -1).join("") || host);
  const name = flat(site);
  const ownSite =
    /wikipedia|wikimedia/i.test(site) ||
    (core.length >= 2 && name.length >= 2 && (name.includes(core) || core.includes(name)));
  return ownSite ? rest.trim() : title.trim();
}
