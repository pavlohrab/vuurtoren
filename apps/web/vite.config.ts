import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { ProxyOptions } from "vite";

/**
 * Dev proxies keep the browser same-origin:
 *  - /nlp  -> the NLP service (docker/nginx does the same in production)
 *  - /anki -> AnkiConnect on this machine. The Origin header is removed so AnkiConnect's
 *    default webCorsOriginList (http://localhost, no port) does not reject the dev server.
 */
const stripOrigin: ProxyOptions["configure"] = (proxy) => {
  proxy.on("proxyReq", (req) => req.removeHeader("origin"));
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/nlp": {
        target: process.env["KENNING_NLP_TARGET"] ?? "http://127.0.0.1:8000",
        rewrite: (p) => p.replace(/^\/nlp/, ""),
        configure: stripOrigin,
      },
      "/anki": {
        target: process.env["KENNING_ANKI_TARGET"] ?? "http://127.0.0.1:8765",
        rewrite: (p) => p.replace(/^\/anki/, ""),
        configure: stripOrigin,
      },
    },
  },
  // sqlite-wasm resolves its .wasm via import.meta.url; pre-bundling breaks that (see packages/db/README.md)
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
