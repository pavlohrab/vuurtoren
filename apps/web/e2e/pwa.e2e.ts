/**
 * Installable app (D0) against `vite preview` of the build: the manifest's icons exist, the
 * service worker registers with scope /, controls the page after a reload, never caches /api
 * or /nlp, and the app shell starts offline.
 */
import { expect, test } from "@playwright/test";

test("manifest icons exist", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    start_url: string;
    scope: string;
    display: string;
    icons: { src: string; sizes: string; type: string }[];
  };
  expect(manifest).toMatchObject({ start_url: "/", scope: "/", display: "standalone" });
  // Chrome's install criteria: a 192px and a 512px icon.
  expect(manifest.icons.map((i) => i.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
  for (const icon of manifest.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()["content-type"], icon.src).toContain(icon.type);
  }
  expect((await request.get("/offline.html")).ok()).toBe(true);
});

test("service worker registers, caches the shell and starts offline", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?demo");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(new URL("/", page.url()).href);
  // The first visit is not controlled (no clients.claim); a reload is.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys())
        urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
  expect(cached).toContain("/index.html");
  expect(cached.some((u) => /^\/(api|nlp|anki)(\/|$)/.test(u))).toBe(false);

  await context.setOffline(true);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library" }).first()).toBeVisible();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
