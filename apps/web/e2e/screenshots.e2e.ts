// README screenshots (docs/images/<screen>-<light|dark>.webp from ?demo): after `pnpm build`, run `SCREENSHOTS=1 pnpm --filter @app/web exec playwright test screenshots`.
import { writeFile } from "node:fs/promises";
import { type Page, expect, test } from "@playwright/test";

const OUT = new URL("../../../docs/images/", import.meta.url);
/** The demo's "today", so the dates and due counts in the images stay put. */
const TODAY = new Date("2026-11-18T13:30:00");

interface Shot {
  name: string;
  /** Viewport height; the width is always 1440. */
  height: number;
  /** Open the screen and set it up; the demo is already loaded. */
  open: (page: Page) => Promise<void>;
}

/** A main navigation link (its name may carry a due count after the label). */
const nav = (page: Page, label: string) =>
  page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: new RegExp(`^${label}`) })
    .click();

const SHOTS: Shot[] = [
  {
    name: "read",
    height: 900,
    open: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "Read" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Stories for you" })).toBeVisible();
    },
  },
  {
    name: "reader",
    height: 740,
    open: async (page) => {
      await page.getByRole("link", { name: "Een dag in Utrecht" }).first().click();
      await expect(page).toHaveURL(/\/read\//);
      await page.locator(".k-reader .k-tok", { hasText: /^bel$/ }).first().click();
      await expect(page.locator(".inspector-panel")).toContainText("bel");
    },
  },
  {
    name: "words",
    height: 900,
    open: async (page) => {
      await nav(page, "Words");
      await expect(page.getByRole("table")).toBeVisible();
    },
  },
  {
    name: "practice",
    height: 640,
    open: async (page) => {
      await nav(page, "Words");
      await page
        .getByRole("navigation", { name: "Words" })
        .getByRole("link", { name: /^Practice/ })
        .click();
      await page.getByRole("button", { name: /^Start/ }).click();
      await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
    },
  },
  {
    name: "courses",
    height: 900,
    open: async (page) => {
      await nav(page, "Courses");
      await page.getByRole("link", { name: "Continue" }).click();
      await page.getByRole("tab", { name: /^Exercises/ }).click();
      await expect(page.getByText("Exercise 1").first()).toBeVisible();
    },
  },
  {
    name: "grammar",
    height: 900,
    open: async (page) => {
      await nav(page, "Grammar");
      await expect(page.getByText("Beginner").first()).toBeVisible();
    },
  },
  {
    name: "exam",
    height: 900,
    open: async (page) => {
      await nav(page, "Exam");
      await expect(page.getByText("The five parts")).toBeVisible();
    },
  },
  {
    name: "talk",
    height: 620,
    open: async (page) => {
      await nav(page, "Talk");
      await expect(page.getByRole("list", { name: "Ways to start" })).toBeVisible();
    },
  },
];

/** Encode a PNG as WebP in the browser (Chromium encodes WebP; Playwright only writes PNG/JPEG). */
async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  const b64 = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return canvas.toDataURL("image/webp", 0.9).split(",")[1]!;
  }, png.toString("base64"));
  return Buffer.from(b64, "base64");
}

test.describe("README screenshots", () => {
  test.skip(!process.env["SCREENSHOTS"], "set SCREENSHOTS=1 to retake the README images");

  for (const scheme of ["light", "dark"] as const) {
    for (const shot of SHOTS) {
      test(`${shot.name} ${scheme}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: 1440, height: shot.height },
          deviceScaleFactor: 1,
          colorScheme: scheme,
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        await page.clock.setFixedTime(TODAY);
        // Headless Chromium has no voices; a user's browser has a Dutch one (Exam shows a warning).
        await page.addInitScript(() => {
          const nl = { lang: "nl-NL", name: "Dutch", default: false, localService: true };
          const synth = window.speechSynthesis;
          if (synth) synth.getVoices = () => [nl as SpeechSynthesisVoice];
        });
        await page.goto("/?demo");
        await expect(page.getByText("Demo data")).toBeVisible();
        await shot.open(page);
        await page.mouse.move(0, shot.height - 1);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        const png = await page.screenshot();
        const encoder = await context.newPage();
        await writeFile(new URL(`${shot.name}-${scheme}.webp`, OUT), await toWebp(encoder, png));
        await context.close();
      });
    }
  }
});
