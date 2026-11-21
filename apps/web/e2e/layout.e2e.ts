/**
 * Desktop layout: the sidebar and the word panel are columns of the layout, never layers over
 * the text. Side by side reflows with the width the reader really has: two columns from 640px
 * of reader width, English under each sentence below. Checked at 1024, 1280 and 1440 wide,
 * with the sidebar expanded and collapsed and the word panel open and closed, and while the
 * window is resized.
 */
import { type Page, expect, test } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };

const right = (b: Box) => b.x + b.width;

async function box(page: Page, selector: string): Promise<Box | null> {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0 || !(await el.isVisible())) return null;
  return el.boundingBox();
}

/** Nothing of the reader is under the sidebar or the open word panel, and nothing scrolls sideways. */
async function expectClear(page: Page, panelOpen: boolean): Promise<void> {
  const sidebar = (await box(page, ".sidebar"))!;
  const content = (await box(page, ".content"))!;
  const panel = panelOpen ? await box(page, ".inspector-panel") : null;
  if (panelOpen) {
    expect(panel, "the word panel is open").not.toBeNull();
    expect(panel!.width).toBeGreaterThan(200);
  }
  expect(content.x).toBeGreaterThanOrEqual(right(sidebar) - 1);
  if (panel) expect(right(content)).toBeLessThanOrEqual(panel.x + 1);
  const rows = page.locator(".k-sbs-row");
  for (let i = 0; i < (await rows.count()); i++) {
    for (const part of [".k-sbs-nl", ".k-sbs-en"]) {
      const b = (await rows.nth(i).locator(part).boundingBox())!;
      expect(b.x, `${part} of row ${i} starts after the sidebar`).toBeGreaterThanOrEqual(
        right(sidebar) - 1,
      );
      if (panel) {
        expect(right(b), `${part} of row ${i} ends before the panel`).toBeLessThanOrEqual(
          panel.x + 1,
        );
      }
    }
  }
  const sideways = await page.locator(".content").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sideways).toBeLessThanOrEqual(1);
}

/** Two columns when the reader is at least 640px wide, English under the Dutch below. */
async function expectColumnsFit(page: Page): Promise<void> {
  const row = page.locator(".k-sbs-row").nth(1);
  const width = await page.locator(".k-sbs-box").evaluate((el) => el.clientWidth);
  const nl = (await row.locator(".k-sbs-nl").boundingBox())!;
  const en = (await row.locator(".k-sbs-en").boundingBox())!;
  if (width >= 640) expect(en.x).toBeGreaterThan(right(nl) - 1);
  else expect(en.y).toBeGreaterThan(nl.y + 10);
}

async function openSideBySide(page: Page): Promise<void> {
  await page.goto("/?demo");
  await page.goto("/read/t-regen");
  await page.getByRole("tab", { name: "Side by side" }).click();
  await expect(page.locator(".k-sbs-row")).toHaveCount(2);
}

async function setSidebar(page: Page, collapsed: boolean): Promise<void> {
  const now = await page.locator(".shell").getAttribute("data-sidebar");
  if ((now === "collapsed") !== collapsed) {
    await page.getByRole("button", { name: /(Collapse|Expand) sidebar/ }).click();
  }
  await expect(page.locator(".shell")).toHaveAttribute(
    "data-sidebar",
    collapsed ? "collapsed" : "expanded",
  );
}

async function setPanel(page: Page, open: boolean): Promise<void> {
  const shell = page.locator(".shell");
  if (open) {
    await page.locator('.k-sbs-row [data-side="nl"]', { hasText: /^bleven$/ }).click();
    await expect(shell).toHaveAttribute("data-inspector", "open");
  } else if ((await shell.getAttribute("data-inspector")) === "open") {
    await page.getByRole("button", { name: "Close the word panel (Esc)" }).click();
    await expect(shell).toHaveAttribute("data-inspector", "closed");
  }
  // The panel's column opens and closes with a short transition.
  await page.waitForTimeout(400);
}

for (const width of [1024, 1280, 1440]) {
  test(`side by side at ${width}px: no column under the sidebar or the word panel`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openSideBySide(page);
    for (const collapsed of [false, true]) {
      await setSidebar(page, collapsed);
      for (const open of [false, true]) {
        await setPanel(page, open);
        await expectClear(page, open);
        await expectColumnsFit(page);
      }
      await setPanel(page, false);
    }
  });
}

test("side by side follows the window as it is resized, with the word panel open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSideBySide(page);
  await setPanel(page, true);
  for (const width of [1360, 1200, 1100, 1000, 920, 1300]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    await expectClear(page, true);
    await expectColumnsFit(page);
  }
});

for (const size of [
  { width: 760, height: 320 },
  { width: 800, height: 360 },
]) {
  test(`a dialog fits a short landscape screen (${size.width}×${size.height}): Save stays reachable`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/?demo");
    await page.goto("/read/t-regen");
    await page.getByRole("button", { name: "More reading options" }).click();
    await page.getByRole("menuitem", { name: "Edit details…" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit details" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    const save = dialog.getByRole("button", { name: "Save" });
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(cancel).toBeInViewport({ ratio: 1 });
    // The fields scroll under the actions; the actions stay put.
    await dialog.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(save).toBeInViewport({ ratio: 1 });
    await dialog.evaluate((el) => el.scrollTo(0, 0));
    await expect(save).toBeInViewport({ ratio: 1 });
    await cancel.click();
    await expect(dialog).toBeHidden();
  });
}

for (const size of [
  { width: 760, height: 320 },
  { width: 360, height: 640 },
]) {
  test(`the tour keeps Next and Skip on screen from Read to the end (${size.width}×${size.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => localStorage.setItem("vuurtoren.tour", "pending"));
    await page.goto("/?demo");
    for (let step = 1; step <= 5; step++) {
      const card = page.locator(".tour-card");
      await expect(card).toContainText(/\d of 5/, { timeout: 10_000 });
      await expect(page.getByRole("button", { name: "Skip the tour" })).toBeInViewport({
        ratio: 1,
      });
      const next = card.getByRole("button", { name: /^(Next|Done|Go to Words)$/ });
      await expect(next).toBeInViewport({ ratio: 1 });
      const n = Number((await page.locator(".tour-count").textContent())!.split(" ")[0]);
      if (n === 5) break;
      // The reader steps bring the story themselves; a tap on the word also goes on.
      await next.click();
    }
    await page
      .locator(".tour-card")
      .getByRole("button", { name: /^(Next|Done)$/ })
      .click();
    await expect(page.locator(".tour-card")).toHaveCount(0);
  });
}
