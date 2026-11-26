/**
 * Quick start clips: a finger taps a word and its card opens; a lesson in Practice starts and an answer turns green. Each test
 * records its page; the video is moved to docs/clips/<name>.webm. A dot shows where the finger
 * goes, drawn by the script on the page.
 */
import { renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Locator, type Page, test } from "@playwright/test";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "clips");
const SIZE = { width: 390, height: 780 };

test.use({ viewport: SIZE, video: { mode: "on", size: SIZE }, hasTouch: true, isMobile: true });

/** The finger: a soft dot that glides to a spot and presses. */
async function finger(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `#clip-finger{position:fixed;z-index:99999;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(143,90,31,.28);border:2px solid rgba(143,90,31,.7);pointer-events:none;transition:left .6s cubic-bezier(.2,.8,.2,1),top .6s cubic-bezier(.2,.8,.2,1),transform .15s;left:50%;top:110%}#clip-finger.down{transform:scale(.75)}`,
  });
  // What a learner wouldn't see: the demo banner and the feedback tab.
  await page.addStyleTag({ content: ".shell-notices,.fb-edge{display:none!important}" });
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "clip-finger";
    document.body.appendChild(d);
  });
}

async function tapOn(page: Page, target: Locator): Promise<void> {
  const b = (await target.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.evaluate(
    ([x, y]) => {
      const f = document.getElementById("clip-finger")!;
      f.style.left = `${x}px`;
      f.style.top = `${y}px`;
    },
    [x, y],
  );
  await page.waitForTimeout(750);
  await page.evaluate(() => document.getElementById("clip-finger")!.classList.add("down"));
  await target.click();
  await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById("clip-finger")!.classList.remove("down"));
}

async function save(page: Page, name: string): Promise<void> {
  const video = page.video();
  await page.close();
  mkdirSync(OUT, { recursive: true });
  renameSync(await video!.path(), join(OUT, `${name}.webm`));
}

test("tap a word", async ({ page }) => {
  await page.goto("/?demo");
  await page.getByRole("link", { name: "Een dag in Utrecht" }).first().click();
  await page.locator(".k-reader .k-tok").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  // The "this text will be hard" note isn't what the clip is about.
  const notNow = page.getByRole("button", { name: "Not now" });
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
  await finger(page);
  await page.waitForTimeout(900);
  await tapOn(page, page.locator(".k-reader .k-tok", { hasText: /^bel$/ }).first());
  await page.waitForTimeout(2600);
  await save(page, "tap-a-word");
});

test("practise", async ({ page }) => {
  await page.goto("/?demo");
  await page.evaluate(() => document.fonts.ready);
  await finger(page);
  await page.waitForTimeout(600);
  await tapOn(page, page.getByRole("link", { name: "Words" }).first());
  await page.waitForTimeout(900);
  await tapOn(page, page.getByRole("link", { name: /^Practice/ }).first());
  await page.waitForTimeout(1200);
  await tapOn(page, page.getByRole("button", { name: /^Start/ }).first());
  await page.waitForTimeout(1300);
  await tapOn(page, page.locator(".ex-choice").first());
  await page.waitForTimeout(2200);
  await save(page, "practise");
});
