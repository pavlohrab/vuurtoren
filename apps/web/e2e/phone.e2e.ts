/**
 * Phone widths (360 and 412 px, touch): nothing sticks out on the right of Read, the reader bar
 * or the word sheet, and the safe areas the Android app reports keep the top bar under the
 * status bar and the tab bar above the gesture handle. `PHONE_SHOTS=<dir>` also saves a
 * screenshot of each screen there.
 */
import { type Locator, type Page, expect, test } from "@playwright/test";
import { fakeAnki } from "./fakeAnki.js";
import { fakeNlp } from "./fakeNlp.js";

const SIZES = [
  { width: 360, height: 800 },
  { width: 412, height: 915 },
] as const;
const SHOTS = process.env["PHONE_SHOTS"];

/** Elements (by selector) whose right edge is past the viewport, with their widths. */
async function overflowing(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? "";
        out.push(`${el.tagName.toLowerCase()}.${el.className} "${name}" ${r.left}–${r.right}`);
      }
    }
    return out;
  }, selector);
}

/** The insets the Android app reports: a 32px status bar and a 34px gesture line. */
async function withInsets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as { VuurtorenInsets?: { get(): string } }).VuurtorenInsets = {
      get: () => '{"top":32,"right":0,"bottom":34,"left":0}',
    };
  });
}

/** A touch drag on an element, as pointer events (vertical by `dy`, or sideways by `dx`). */
async function drag(page: Page, target: Locator, dy: number, dx = 0): Promise<void> {
  await target.evaluate(
    (el, [dy, dx]) => {
      const r = el.getBoundingClientRect();
      const x0 = r.left + r.width / 2;
      const y0 = r.top + r.height / 2;
      const at = (type: string, x: number, y: number) =>
        new PointerEvent(type, {
          pointerType: "touch",
          isPrimary: true,
          pointerId: 9,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: x,
          clientY: y,
          bubbles: true,
        } as PointerEventInit);
      el.dispatchEvent(at("pointerdown", x0, y0));
      for (let i = 1; i <= 5; i++) {
        el.dispatchEvent(at("pointermove", x0 + (dx * i) / 5, y0 + (dy * i) / 5));
      }
      el.dispatchEvent(at("pointerup", x0 + dx, y0 + dy));
    },
    [dy, dx] as const,
  );
}

/**
 * A real finger swipe (Chromium's touch input over CDP): the browser turns it into touch
 * pointer events, and decides itself whether the page may pan instead (touch-action).
 */
async function swipe(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(...from) });
  for (let i = 1; i <= 6; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / 6;
    const y = from[1] + ((to[1] - from[1]) * i) / 6;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x, y) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

for (const size of SIZES) {
  test.describe(`phone ${size.width}px`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

    test("Read, the reader bar and the word sheet fit the screen", async ({ page }) => {
      await page.goto("/?demo");
      await expect(page.getByText("Demo data")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Read" })).toBeVisible();
      // The level's separator has room on both sides ("A1 · Start here").
      await expect(page.locator(".lib-story-sep").first()).toBeVisible();
      expect(await overflowing(page, ".topbar *, .page-header *")).toEqual([]);
      await shot(page, `read-${size.width}`);

      await page.getByRole("link", { name: "Een dag in Utrecht" }).first().click();
      await expect(page).toHaveURL(/\/read\//);
      await expect(page.locator(".k-reader .k-tok").first()).toBeVisible();
      expect(await overflowing(page, ".topbar button, .topbar [role=tab], .topbar span")).toEqual(
        [],
      );
      await shot(page, `reader-${size.width}`);

      await page.locator(".k-reader .k-tok", { hasText: /^bel$/ }).first().click();
      const sheet = page.locator(".inspector-panel");
      await expect(sheet).toContainText("bel");
      await page.waitForTimeout(400);
      expect(await overflowing(page, ".inspector-panel, .inspector-panel button")).toEqual([]);
      await shot(page, `word-${size.width}`);

      // A swipe to the left turns to the next page.
      await page.keyboard.press("Escape");
      const count = page.locator(".reader-pager-count [aria-hidden]");
      const before = await count.textContent();
      await page.locator(".reader-turn").evaluate((el) => {
        const at = (type: string, x: number, t: number) =>
          new PointerEvent(type, {
            pointerType: "touch",
            isPrimary: true,
            pointerId: 7,
            clientX: x,
            clientY: 300,
            bubbles: true,
            timeStamp: t,
          } as PointerEventInit);
        el.dispatchEvent(at("pointerdown", 300, 0));
        el.dispatchEvent(at("pointerup", 80, 100));
      });
      await expect(count).not.toHaveText(before ?? "");
    });

    test("a new learner: the welcome, the story in the reader, the word sheet", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await fakeNlp(page);
      await fakeAnki(page);
      await page.goto("/");
      // The first start sets up the database in the browser first: allow for it.
      await expect(page.getByRole("heading", { name: "Welcome to Vuurtoren" })).toBeVisible({
        timeout: 40_000,
      });
      await page.getByRole("radio", { name: /^No/ }).check();
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "The most common words" })).toBeVisible();
      expect(await overflowing(page, ".ob-card *")).toEqual([]);
      await shot(page, `welcome-words-${size.width}`);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Start reading" }).click();
      await expect(page).toHaveURL(/[/]read[/]/);
      await expect(page.locator(".k-reader .k-tok").first()).toBeVisible();
      // The walkthrough: a spotlight on Read in the tab bar, then a word, then on.
      await expect(page.getByRole("dialog", { name: "Read" })).toBeVisible();
      await shot(page, `tour-${size.width}`);
      // Taps outside the bubble stay with the walkthrough: the Words tab does not open.
      const words = page.getByRole("navigation", { name: "Main" }).getByRole("link").last();
      const tab = await words.boundingBox();
      await page.touchscreen.tap(tab!.x + tab!.width / 2, tab!.y + tab!.height / 2);
      await expect(page).toHaveURL(/[/]read[/]/);
      await expect(page.getByRole("dialog", { name: "Read" })).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
      await expect(page.getByRole("dialog", { name: "Tap a word" })).toBeVisible();
      await shot(page, `tour-word-${size.width}`);
      await page.getByRole("button", { name: "Skip the tour" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await overflowing(page, ".topbar button, .topbar [role=tab], .topbar span")).toEqual(
        [],
      );
      await shot(page, `reader-native-${size.width}`);

      // The mode is one button on a phone, with the four modes in a menu.
      await page.getByRole("button", { name: /^Reading mode: Read/ }).click();
      await page.getByRole("radio", { name: /^Gloss/ }).click();
      await expect(page.getByRole("button", { name: /^Reading mode: Gloss/ })).toBeVisible();

      // The word sheet opens at a peek, the handle shows everything, a tap outside closes it.
      await page.locator(".k-reader .k-tok").nth(1).click();
      const sheet = page.locator(".inspector-panel");
      await expect(sheet).toHaveAttribute("data-sheet", "peek");
      await page.waitForTimeout(400);
      expect(await overflowing(page, ".inspector-panel, .inspector-panel button")).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        size.width,
      );
      await shot(page, `sheet-peek-${size.width}`);
      await page.getByRole("button", { name: "Show all of the word panel" }).click();
      await expect(sheet).toHaveAttribute("data-sheet", "full");
      await page.waitForTimeout(400);
      await shot(page, `sheet-full-${size.width}`);
      await page.getByRole("button", { name: "Show less of the word panel" }).click();
      await page.locator(".topbar").click({ position: { x: 4, y: 4 } });
      await expect(page.locator(".shell")).toHaveAttribute("data-inspector", "closed");
    });

    test("safe areas from the app keep the bars clear of the system bars", async ({ page }) => {
      await page.addInitScript(() => {
        (window as { VuurtorenInsets?: { get(): string } }).VuurtorenInsets = {
          get: () => '{"top":32,"right":0,"bottom":34,"left":0}',
        };
      });
      await page.goto("/?demo");
      await expect(page.getByText("Demo data")).toBeVisible();
      const notices = await page.locator(".main").evaluate((el) => {
        const first = el.firstElementChild as HTMLElement;
        return first.getBoundingClientRect().top;
      });
      expect(notices).toBeGreaterThanOrEqual(32);
      // Three thumb-sized tabs, all of them 8px or more above the gesture handle (34px here).
      const nav = page.getByRole("navigation", { name: "Main" });
      const tabs = nav.locator(".nav-link:visible, .nav-more");
      await expect(tabs).toHaveCount(3);
      for (const box of await tabs.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect),
      )) {
        expect(box.height).toBeGreaterThanOrEqual(56);
        expect(box.bottom).toBeLessThanOrEqual(size.height - 34 - 8);
      }
      await shot(page, `insets-${size.width}`);
    });

    test("a finger swipe turns the page both ways (34px gesture line)", async ({ page }) => {
      await withInsets(page);
      await page.goto("/?demo");
      await page.getByRole("link", { name: "Een dag in Utrecht" }).first().click();
      await expect(page.locator(".k-reader .k-tok").first()).toBeVisible();
      const count = page.locator(".reader-pager-count [aria-hidden]");
      await expect(count).toHaveText(/^1 \/ \d+$/);
      // Let the cover-to-reader transition end: during it the page itself takes every touch.
      await page.waitForTimeout(600);
      const box = (await page.locator(".reader-turn").boundingBox())!;
      const y = box.y + Math.min(box.height / 2, 120);
      const [left, right] = [size.width * 0.2, size.width * 0.8];
      await swipe(page, [right, y], [left, y + 8]);
      await expect(count).toHaveText(/^2 \/ \d+$/);
      await swipe(page, [left, y], [right, y]);
      await expect(count).toHaveText(/^1 \/ \d+$/);
      // A mostly vertical drag is a scroll, not a page turn.
      await swipe(page, [size.width / 2, y + 100], [size.width / 2 + 30, y - 60]);
      await page.waitForTimeout(300);
      await expect(count).toHaveText(/^1 \/ \d+$/);
    });

    test("side by side on a bundled story: English under each sentence, pairs, structure", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await withInsets(page);
      // No language server at all: the story's English and pairs ship with the app.
      const asked: string[] = [];
      await page.route("**/nlp/**", (route) => {
        if (route.request().url().includes("/translate/pairs")) asked.push(route.request().url());
        return route.abort();
      });
      await page.addInitScript(() =>
        localStorage.setItem("vuurtoren-reader-prefs", JSON.stringify({ english: "always" })),
      );
      await page.goto("/");
      await page.getByRole("button", { name: "Skip setup for now" }).click({ timeout: 40_000 });
      await page
        .getByRole("button", { name: /De koe op de toren/ })
        .first()
        .click();
      await expect(page.locator(".k-reader .k-tok").first()).toBeVisible();
      await page.getByRole("button", { name: /^Reading mode:/ }).click();
      await page.getByRole("radio", { name: /^Side by side/ }).click();

      const row = page.locator(".k-sbs-row").first();
      const nl = row.locator(".k-sbs-nl");
      const en = row.locator(".k-sbs-en");
      await expect(en).toBeVisible();
      await expect(en.locator('[data-side="en"]').first()).toBeVisible();
      // Narrow: the English sits under its Dutch sentence, and nothing sticks out.
      const [a, b] = [(await nl.boundingBox())!, (await en.boundingBox())!];
      expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        size.width,
      );
      await shot(page, `sbs-${size.width}`);

      // A tap on a Dutch word lights its English partner.
      const word = row.locator('[data-side="nl"][data-pair]').first();
      const pair = await word.getAttribute("data-pair");
      await word.tap();
      await expect(row.locator(`[data-side="en"][data-pair="${pair}"]`).first()).toHaveAttribute(
        "data-active",
        "",
      );
      await page.keyboard.press("Escape");

      // The structure view: colours on every pair and the word-order note, then off again.
      const structure = row.getByRole("button", { name: "Structure" });
      await structure.tap();
      await expect(row.locator("[data-pc]").first()).toBeVisible();
      await shot(page, `sbs-structure-${size.width}`);
      await structure.tap();
      await expect(row.locator("[data-pc]")).toHaveCount(0);
      expect(asked).toEqual([]);
    });

    test("Your words as cards: swipe right for I know it, Undo, swipe left to keep learning", async ({
      page,
    }) => {
      await withInsets(page);
      await page.goto("/?demo");
      await expect(page.getByText("Demo data")).toBeVisible();
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: /^Words/ })
        .click();
      await page.getByRole("link", { name: "Your words" }).click();
      const card = page.getByRole("group", { name: /Swipe right/ });
      await expect(card).toBeVisible();
      await expect(card.locator(".word-stack-meaning")).not.toBeEmpty();
      // The chips scroll sideways in their row; nothing else sticks out.
      expect(
        await overflowing(page, ".word-stack-card, .word-stack-actions *, .word-stack-chips"),
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        size.width,
      );
      await shot(page, `words-stack-${size.width}`);
      // The two buttons sit above the tab bar without scrolling.
      const knownBox = (await page.getByRole("button", { name: "I know it" }).boundingBox())!;
      expect(knownBox.y + knownBox.height).toBeLessThanOrEqual(size.height - 34 - 64);
      const word = () => card.locator("h2").textContent();
      const first = await word();
      // Let the page transition end: during it the page itself takes every touch.
      await page.waitForTimeout(600);
      const box = (await card.boundingBox())!;
      const y = box.y + box.height / 2;
      const [left, right] = [box.x + box.width * 0.25, box.x + box.width * 0.85];

      await swipe(page, [left, y], [right, y + 6]);
      await expect(page.getByRole("status").filter({ hasText: "Marked as known" })).toBeVisible();
      await expect.poll(word).not.toBe(first);
      // The Undo toast sits above the tab bar, and Undo brings the word back.
      const undo = page.getByRole("button", { name: "Undo" });
      expect((await undo.boundingBox())!.y).toBeLessThan(size.height - 34 - 64);
      await undo.click();
      await expect.poll(word).toBe(first);

      await swipe(page, [right, y], [left, y]);
      await expect(page.getByRole("status").filter({ hasText: "Kept for learning" })).toBeVisible();
      await expect.poll(word).not.toBe(first);
      // A short drag springs back: still the same card.
      const second = await word();
      await swipe(page, [box.x + box.width / 2, y], [box.x + box.width / 2 + 40, y]);
      await page.waitForTimeout(400);
      expect(await word()).toBe(second);
    });

    test("the word sheet opens as a small peek above the gesture line", async ({ page }) => {
      await withInsets(page);
      await page.goto("/?demo");
      await page.getByRole("link", { name: "Een dag in Utrecht" }).first().click();
      await page.locator(".k-reader .k-tok", { hasText: /^bel$/ }).first().click();
      const sheet = page.locator(".inspector-panel");
      await expect(sheet).toHaveAttribute("data-sheet", "peek");
      await page.waitForTimeout(500);
      const seen = await sheet.evaluate((el) => el.getBoundingClientRect().top);
      // About 28–32% of the screen (a little more on the shorter one).
      expect(size.height - seen).toBeLessThanOrEqual(size.height * 0.34);
      expect(size.height - seen).toBeGreaterThanOrEqual(size.height * 0.2);
      // The two main buttons, fully above the 34px gesture line; the details wait below.
      const known = sheet.getByRole("button", { name: "I know it" });
      const box = await known.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height - 34);
      expect(box!.y).toBeGreaterThan(seen);
      const context = await sheet
        .getByText("In context")
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(context).toBeGreaterThanOrEqual(size.height - 34);
      await shot(page, `sheet-small-peek-${size.width}`);

      // A drag up shows the details; a drag down goes back, and once more closes it.
      const grip = sheet.locator(".sheet-grip");
      await drag(page, grip, -160);
      await expect(sheet).toHaveAttribute("data-sheet", "full");
      await expect(sheet.getByText("In context")).toBeInViewport();
      await drag(page, grip, 160);
      await expect(sheet).toHaveAttribute("data-sheet", "peek");
      await drag(page, grip, 160);
      await expect(page.locator(".shell")).toHaveAttribute("data-inspector", "closed");
    });

    test("controls used often have finger-sized targets (44px, menu rows 48px)", async ({
      page,
    }) => {
      /** Visible matches smaller than `min` in either direction, with their sizes. */
      const small = (selector: string, min: number, which: "both" | "height" = "both") =>
        page.evaluate(
          ([sel, min, which]) => {
            const out: string[] = [];
            for (const el of document.querySelectorAll<HTMLElement>(sel)) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              if (r.height < min - 0.5 || (which === "both" && r.width < min - 0.5)) {
                const name = el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
                out.push(`${name.slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`);
              }
            }
            return out;
          },
          [selector, min, which] as const,
        );
      await page.goto("/?demo");
      // Library: the "…" of each cover.
      await expect(page.locator(".lib-menu-btn").first()).toBeVisible();
      expect(await small(".lib-menu-btn", 44)).toEqual([]);
      await page.getByRole("link", { name: "Een dag in Utrecht" }).first().click();
      await expect(page.locator(".k-reader .k-tok").first()).toBeVisible();
      // The reader bar's buttons.
      expect(await small(".topbar-page button", 44, "height")).toEqual([]);
      expect(await small(".topbar-page .rbar-btn", 44)).toEqual([]);
      // The reader's menu rows.
      await page.getByRole("button", { name: "More reading options" }).click();
      // The menu scales in: measure once it has.
      await page.waitForTimeout(400);
      expect(await small(".rmenu-item", 48, "height")).toEqual([]);
      await page.keyboard.press("Escape");
      // The word sheet's close button.
      await page.locator(".k-reader .k-tok", { hasText: /^bel$/ }).first().click();
      await expect(page.locator(".shell")).toHaveAttribute("data-inspector", "open");
      expect(await small(".inspector-head button", 44)).toEqual([]);
    });

    test("keyboard hints wait for a hardware keyboard; touch hints show instead", async ({
      page,
    }) => {
      await page.goto("/?demo");
      await page.goto("/practice");
      const about = page.locator(".practice-about");
      await expect(about).toContainText("Tap an answer, then Check.");
      await expect(about.locator(".k-keyhint")).toBeHidden();
      await page.goto("/read/t-regen");
      await page.getByRole("button", { name: "More reading options" }).click();
      await expect(page.getByRole("menuitem", { name: /Focus mode/ })).toBeVisible();
      await expect(page.locator(".rmenu-kbd").first()).toBeHidden();
      await expect(page.getByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeHidden();
      // A key from a hardware keyboard: the caps and the shortcuts come back.
      await page.keyboard.press("Shift");
      await expect(page.locator(".rmenu-kbd").first()).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeVisible();
    });
  });
}
