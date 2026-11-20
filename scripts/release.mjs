#!/usr/bin/env node
/**
 * `pnpm release 0.2.0`: set the app version everywhere, commit and tag `v0.2.0`.
 * Pushing the tag (`git push origin main --tags`) builds the desktop installers and the images.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: pnpm release <major.minor.patch>, for example pnpm release 0.2.0");
  process.exit(1);
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (git("status", "--porcelain")) {
  console.error("Commit or stash your changes first.");
  process.exit(1);
}
if (git("tag", "--list", `v${version}`)) {
  console.error(`Tag v${version} already exists.`);
  process.exit(1);
}

/** Replace exactly one match of `pattern` in `file`. */
function bump(file, pattern, replace) {
  const text = readFileSync(file, "utf8");
  const matches = text.match(new RegExp(pattern.source, pattern.flags + "g")) ?? [];
  if (matches.length !== 1) {
    console.error(`${file}: expected one version line, found ${matches.length}.`);
    process.exit(1);
  }
  writeFileSync(file, text.replace(pattern, replace));
  return file;
}

const files = [
  bump("package.json", /("version": )"[^"]+"/, `$1"${version}"`),
  bump("apps/desktop/package.json", /("version": )"[^"]+"/, `$1"${version}"`),
  bump("apps/desktop/src-tauri/Cargo.toml", /^(version = )"[^"]+"/m, `$1"${version}"`),
  bump(
    "apps/desktop/src-tauri/Cargo.lock",
    /(name = "vuurtoren-desktop"\nversion = )"[^"]+"/,
    `$1"${version}"`,
  ),
  bump("server/nlp/pyproject.toml", /^(version = )"[^"]+"/m, `$1"${version}"`),
  bump("server/nlp/uv.lock", /(name = "vuurtoren-nlp"\nversion = )"[^"]+"/, `$1"${version}"`),
];

git("add", ...files);
git("commit", "-m", `release: ${version}`);
git("tag", "-a", `v${version}`, "-m", `Vuurtoren ${version}`);
console.log(`Tagged v${version}. To publish: git push origin main --tags`);
