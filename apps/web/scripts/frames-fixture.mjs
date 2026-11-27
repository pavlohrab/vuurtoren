// Tokens for the sentence-structure test set (packages/core/src/nl/frames.cases.ts), from a running
// language server, saved next to it as frames.fixture.json so the test runs without the server.
// Usage: node scripts/frames-fixture.mjs [http://127.0.0.1:8011]
import { readFileSync, writeFileSync } from "node:fs";

const server = process.argv[2] ?? "http://127.0.0.1:8011";
const dir = new URL("../../../packages/core/src/nl/", import.meta.url);
const cases = readFileSync(new URL("frames.cases.ts", dir), "utf8");
const sentences = [
  ...cases.matchAll(/sentence:\s*\n?\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g),
].map((m) =>
  JSON.parse(m[1].startsWith("'") ? `"${m[1].slice(1, -1).replace(/"/g, '\\"')}"` : m[1]),
);
const res = await fetch(`${server}/analyze/text`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ lang: "nl", texts: sentences }),
});
if (!res.ok) throw new Error(`The language server answered ${res.status}`);
const analyses = await res.json();
const out = Object.fromEntries(sentences.map((s, k) => [s, analyses[k].tokens]));
writeFileSync(new URL("frames.fixture.json", dir), JSON.stringify(out, null, 0) + "\n");
console.log(`${sentences.length} sentences`);
