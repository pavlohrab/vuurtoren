import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke test (`pnpm e2e`) against `vite preview` of the built app (`pnpm build`
 * first). The language server is faked in the test (e2e/fakeNlp.ts), so no Python is needed.
 */
// E2E_PORT: a second checkout (a worktree) running its tests at the same time needs its own.
const PORT = Number(process.env["E2E_PORT"] ?? 4174);

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
