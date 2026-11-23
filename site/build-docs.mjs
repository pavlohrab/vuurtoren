#!/usr/bin/env node
/**
 * The docs website: puts every page of docs/*.md into one hand-made template
 * (site/docs-template/) and writes site/docs/*.html, so the docs on the website never drift
 * from the Markdown in the repo. `pnpm site:docs` runs it; edit the Markdown, not the output.
 *
 * Links between docs pages become links between the HTML pages; links to anything else in docs/
 * (docs/dev, the design system) go to the file on GitHub.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site", "docs");
const REPO = "https://github.com/pavlohrab/Vuurtoren";

/** The chapters, in reading order: each page's Markdown file and its name in the menu. */
const CHAPTERS = [
  {
    title: "Start here",
    pages: [
      ["guide/quick-start.md", "Quick start"],
      ["guide/install.md", "Install Vuurtoren"],
    ],
  },
  {
    title: "Use it",
    pages: [
      ["guide/reading.md", "Reading"],
      ["guide/words.md", "Your words"],
      ["guide/anki.md", "Anki"],
    ],
  },
  {
    title: "Your devices",
    pages: [
      ["phones.md", "On your phone"],
      ["guide/sync.md", "Sync your devices"],
      ["guide/self-host.md", "Your own server"],
    ],
  },
  {
    title: "More",
    pages: [
      ["ai.md", "Add your AI"],
      ["how-it-works.md", "How Vuurtoren works"],
      ["roadmap.md", "Roadmap"],
    ],
  },
];

/** The home page's task cards: what people come to do, and the page that does it. */
const TASKS = [
  ["guide/quick-start.md", "Quick start", "From installing to your first text, in five steps."],
  ["guide/install.md", "Install Vuurtoren", "On Windows, Mac, Linux or Android."],
  ["guide/reading.md", "Read a text", "Paste it, give a link, or add a PDF or a photo."],
  ["guide/words.md", "Learn new words every day", "The daily review, and how many new words."],
  ["guide/anki.md", "Use my Anki decks", "Bring them in, or keep using Anki."],
  ["phones.md", "Use it on my phone too", "What works on a phone, and how to connect it."],
];

const pages = CHAPTERS.flatMap((c) =>
  c.pages.map(([file, label]) => ({ file, label, group: c.title })),
);
const slugOf = (file) => posix.basename(file, ".md");
const hrefOf = new Map(pages.map((p) => [p.file, `${slugOf(p.file)}.html`]));

const template = readFileSync(join(root, "site", "docs-template", "template.html"), "utf8");
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const plain = (html) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const slugify = (s) =>
  plain(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");

/** A link in `fromFile` (a docs-relative path) as it should be on the website. */
function rewrite(href, fromFile) {
  if (/^[a-z]+:|^#/.test(href)) return href;
  const [path, hash = ""] = href.split("#");
  const target = posix.normalize(posix.join(posix.dirname(fromFile), path));
  const tail = hash ? `#${hash}` : "";
  if (hrefOf.has(target)) return hrefOf.get(target) + tail;
  if (target.startsWith("../"))
    return `${REPO}/blob/main/${posix.normalize(posix.join("docs", target))}${tail}`;
  return `${REPO}/blob/main/docs/${target}${tail}`;
}

function render(file) {
  const md = readFileSync(join(root, "docs", file), "utf8");
  const heads = [];
  let title = "";
  let summary = "";
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    if (depth === 1) {
      title = plain(text);
      return `<h1>${text}</h1>\n`;
    }
    const id = slugify(text);
    if (depth === 2) heads.push([id, plain(text)]);
    return `<h${depth} id="${id}">${text}</h${depth}>\n`;
  };
  renderer.link = function ({ href, title: t, tokens }) {
    const text = this.parser.parseInline(tokens);
    return `<a href="${esc(rewrite(href, file))}"${t ? ` title="${esc(t)}"` : ""}>${text}</a>`;
  };
  const html = marked.parse(md, { renderer, gfm: true });
  const first = html.match(/<\/h1>\s*<p>([\s\S]*?)<\/p>/);
  if (first) summary = plain(first[1]).replace(/\s+/g, " ").trim();
  return { html, title, summary, heads, text: plain(html).replace(/\s+/g, " ").toLowerCase() };
}

function nav(current) {
  const groups = CHAPTERS.map(
    (c) =>
      `      <div><h4>${esc(c.title)}</h4><ul>${c.pages
        .map(([file, label]) => {
          const on = file === current ? ' aria-current="page"' : "";
          return `<li><a href="${hrefOf.get(file)}"${on}>${esc(label)}</a></li>`;
        })
        .join("")}</ul></div>`,
  );
  groups.push(
    `      <div class="dev"><h4>For developers</h4><ul><li><a href="${REPO}/tree/main/docs/dev">On GitHub (docs/dev)</a></li></ul></div>`,
  );
  return groups.join("\n");
}

const rendered = new Map(pages.map((p) => [p.file, render(p.file)]));
const index = JSON.stringify(
  pages.map((p) => {
    const r = rendered.get(p.file);
    return {
      href: hrefOf.get(p.file),
      title: r.title || p.label,
      summary: r.summary.slice(0, 140),
      heads: r.heads.map((h) => h[1]).join(" · "),
      text: r.text.slice(0, 6000),
    };
  }),
).replace(/</g, "\\u003c");

function page({ title, summary, nav: navHtml, content, pager, edit, onpage }) {
  return template
    .replace("{{TITLE}}", esc(title))
    .replace("{{SUMMARY}}", esc(summary))
    .replace("{{NAV}}", navHtml)
    .replace("{{CONTENT}}", content)
    .replace("{{PAGER}}", pager)
    .replace("{{EDIT}}", edit)
    .replace("{{ONPAGE}}", onpage)
    .replace("{{INDEX}}", index);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(join(root, "site", "docs-template", "docs.css"), join(out, "docs.css"));

pages.forEach((p, i) => {
  const r = rendered.get(p.file);
  const prev = pages[i - 1];
  const next = pages[i + 1];
  const pager = `    <nav class="pager" aria-label="More pages">${
    prev
      ? `<a href="${hrefOf.get(prev.file)}"><span>Back</span>${esc(prev.label)}</a>`
      : "<span></span>"
  }${next ? `<a class="nx" href="${hrefOf.get(next.file)}"><span>Next</span>${esc(next.label)}</a>` : ""}</nav>`;
  const onpage = r.heads.length
    ? `<b>On this page</b>${r.heads.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join("")}`
    : "";
  const crumb = p.group === p.label ? esc(p.group) : `${esc(p.group)} › ${esc(p.label)}`;
  const content = `    <div class="crumb">${crumb}</div>\n${r.html}`;
  writeFileSync(
    join(out, hrefOf.get(p.file)),
    page({
      title: r.title || p.label,
      summary: r.summary,
      nav: nav(p.file),
      content,
      pager,
      edit: `${REPO}/edit/main/docs/${p.file}`,
      onpage,
    }),
  );
});

const home = `    <h1>What do you want to do?</h1>
    <p class="sum">Pick what you want to do. Each page is one task, explained in plain words.</p>
    <div class="tasks">
${TASKS.map(([file, t, s]) => `      <a href="${hrefOf.get(file)}"><b>${esc(t)}</b><span>${esc(s)}</span></a>`).join("\n")}
    </div>
    <div class="box help"><b class="h">Stuck?</b><span>Ask on <a href="${REPO}/issues">GitHub</a>. Say what you tried and what you saw.</span></div>`;
writeFileSync(
  join(out, "index.html"),
  page({
    title: "Vuurtoren docs",
    summary: "How to install and use Vuurtoren, in plain words.",
    nav: nav(null),
    content: home,
    pager: "",
    edit: `${REPO}/tree/main/docs`,
    onpage: "",
  }),
);

console.log(
  `docs: ${pages.length + 1} pages in ${relative(root, out)}/ (${normalize("docs")} → html)`,
);
