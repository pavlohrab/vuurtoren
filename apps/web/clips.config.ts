/**
 * The Quick start clips (WD9): short recordings of the real app on the demo data, made again
 * whenever the app changes. `pnpm clips` (after `vite build`) writes them to docs/clips.
 */
import { defineConfig } from "@playwright/test";

const PORT = 4179;

export default defineConfig({
  testDir: "clips",
  testMatch: "*.clip.ts",
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
  },
});
