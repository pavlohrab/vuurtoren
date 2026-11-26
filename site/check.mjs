// Check the website at phone and computer widths: nothing wider than the screen, no text cut
// off inside a box, no text squeezed into a column too narrow to read.
//   node site/check.mjs            (uses the repository's Playwright)
// Exits with 1 and lists the problems when there are any.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "apps", "web", "package.json"));
const { chromium } = require("@playwright/test");

const pages = [
  "index.html",
  "desktop.html",
  "phone.html",
  "how.html",
  "about.html",
  "docs/index.html",
  "docs/reading.html",
  "docs/ai.html",
];
const widths = [390, 768, 1280];
const problems = [];

const browser = await chromium.launch();
for (const width of widths) {
  for (const page of pages) {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    await p.goto("file://" + join(here, page));
    // Let every section play its entrance, as a reader scrolling down would.
    for (const el of await p.$$("section, header")) {
      await el.scrollIntoViewIfNeeded();
      await p.waitForTimeout(150);
    }
    await p.waitForTimeout(1600);
    const found = await p.evaluate(() => {
      const out = [];
      const name = (e) =>
        e.tagName.toLowerCase() +
        (e.id ? "#" + e.id : "") +
        [...e.classList].map((c) => "." + c).join("");
      if (document.documentElement.scrollWidth > innerWidth + 1)
        out.push(
          `page is ${document.documentElement.scrollWidth - innerWidth}px wider than the screen`,
        );
      for (const e of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const text = (e.innerText || "").trim();
        // Content cut off by a box that hides its overflow (sideways-scrolling boxes are fine).
        if (
          (cs.overflowY === "hidden" || cs.overflow === "hidden") &&
          text &&
          e.scrollHeight > e.clientHeight + 4 &&
          !e.closest(".peek, .phone, .win, .page")
        )
          out.push(`${name(e)} cuts off ${e.scrollHeight - e.clientHeight}px of its content`);
        // Text squeezed into a column narrower than a short word.
        const r = e.getBoundingClientRect();
        if (
          text.length > 12 &&
          e.getClientRects().length > 0 &&
          r.width < 48 &&
          e.children.length === 0 &&
          cs.position !== "absolute"
        )
          out.push(`${name(e)} squeezes "${text.slice(0, 20)}" into ${Math.round(r.width)}px`);
      }
      return out;
    });
    for (const f of found) problems.push(`${page} @ ${width}px: ${f}`);
    await p.close();
  }
}
await browser.close();

if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${pages.length} pages at ${widths.join(", ")} px`);
