import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { Plugin, ProxyOptions } from "vite";

/**
 * Dev proxies keep the browser same-origin:
 *  - /nlp  -> the NLP service (docker/nginx does the same in production)
 *  - /api  -> the Vuurtoren API (server storage mode), only when VUURTOREN_API_TARGET is set, e.g.
 *    http://127.0.0.1:8787. Without it the dev server stays in browser (OPFS) mode.
 *  - /anki -> AnkiConnect on this machine. The Origin header is removed so AnkiConnect's
 *    default webCorsOriginList (http://localhost, no port) does not reject the dev server.
 */
const stripOrigin: ProxyOptions["configure"] = (proxy) => {
  proxy.on("proxyReq", (req) => req.removeHeader("origin"));
};

const apiTarget = process.env["VUURTOREN_API_TARGET"];

/** The product version (root package.json) and, in image builds, the commit (VUURTOREN_COMMIT). */
const rootPackage = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };
const commit = (process.env["VUURTOREN_COMMIT"] ?? "").slice(0, 7);

/**
 * The service worker (installable app): sw/sw.js with the app shell's file list and a
 * version hash filled in, emitted as /sw.js on build. Fonts: only the latin subsets are
 * precached (the others load and are cached on first use). The dev server has no worker.
 */
function vuurtorenServiceWorker(): Plugin {
  const publicDir = new URL("./public/", import.meta.url);
  return {
    name: "vuurtoren-sw",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter(
        (f) =>
          f === "index.html" ||
          /\.(js|css|wasm)$/.test(f) ||
          (/\.woff2$/.test(f) && /-latin(-ext)?-/.test(f)),
      );
      const pub = readdirSync(publicDir).filter((f) => !f.startsWith("."));
      const files = [...built, ...pub].sort();
      const hash = createHash("sha256");
      for (const f of files) hash.update(f);
      for (const f of pub) hash.update(readFileSync(new URL(f, publicDir)));
      const index = bundle["index.html"];
      if (index?.type === "asset") hash.update(index.source);
      const source = readFileSync(new URL("./sw/sw.js", import.meta.url), "utf8")
        .replace('"__VUURTOREN_SW_VERSION__"', JSON.stringify(hash.digest("hex").slice(0, 12)))
        .replace("__VUURTOREN_SW_PRECACHE__", JSON.stringify(files.map((f) => `/${f}`)));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), vuurtorenServiceWorker()],
  define: {
    __VUURTOREN_VERSION__: JSON.stringify(rootPackage.version),
    __VUURTOREN_COMMIT__: JSON.stringify(commit),
    // A store build (VUURTOREN_STORE=play) leaves updates to its store (updates.ts).
    __VUURTOREN_STORE__: JSON.stringify(process.env.VUURTOREN_STORE ?? ""),
  },
  server: {
    port: 5173,
    proxy: {
      ...(apiTarget ? { "/api": { target: apiTarget } } : {}),
      "/nlp": {
        target: process.env["VUURTOREN_NLP_TARGET"] ?? "http://127.0.0.1:8000",
        rewrite: (p) => p.replace(/^\/nlp/, ""),
        configure: stripOrigin,
      },
      "/anki": {
        target: process.env["VUURTOREN_ANKI_TARGET"] ?? "http://127.0.0.1:8765",
        rewrite: (p) => p.replace(/^\/anki/, ""),
        configure: stripOrigin,
      },
    },
  },
  // sqlite-wasm resolves its .wasm via import.meta.url; pre-bundling breaks that (see packages/db/README.md)
  // The FSRS optimizer finds its .wasm the same way.
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm", "@open-spaced-repetition/binding-wasm32-wasip1"],
  },
  // Workers (database, package reading, optimizer) are ES modules with top-level await.
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
    // Screen tests render whole pages (stories and their data included); on a busy machine 5 s is
    // too tight. A real hang still fails.
    testTimeout: 15_000,
  },
});
