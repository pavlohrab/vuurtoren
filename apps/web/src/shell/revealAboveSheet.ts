/**
 * Below 900px the inspector is a bottom sheet. After selecting a word, scroll the content so
 * the word sits above the sheet instead of under it. Runs after the sheet has laid out.
 * A book page can't scroll: `liftAboveSheet` says how far to lift the text instead, and the
 * page stays on its screen.
 */
/** The share of the screen the sheet shows at its peek before it has been measured. */
const SHEET_PEEK = 0.3;
const MARGIN = 24;

/** The peek's height: measured into `--sheet-peek` (useBottomSheet.ts), else a guess. */
function peekHeight(sheet: HTMLElement): number {
  const measured = parseFloat(sheet.style.getPropertyValue("--sheet-peek"));
  return Number.isFinite(measured) ? measured : window.innerHeight * SHEET_PEEK;
}

const isSheet = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(max-width: 899px)").matches;

/** Where the sheet's top comes to rest (it may still be sliding up), or null without one. */
function sheetTop(): number | null {
  const sheet = document.querySelector<HTMLElement>(".inspector-panel");
  if (!sheet) return null;
  // Its bottom edge is fixed, and it opens at the peek (useBottomSheet.ts).
  const bottom = sheet.getBoundingClientRect().bottom;
  const slide = new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;
  const shown =
    sheet.dataset["sheet"] === "full"
      ? sheet.offsetHeight
      : Math.min(sheet.offsetHeight, peekHeight(sheet));
  return bottom - slide - shown;
}

export function revealAboveSheet(target: Element | null): void {
  if (!target || !isSheet()) return;
  requestAnimationFrame(() => {
    const content = document.getElementById("content");
    const top = sheetTop();
    if (top === null || !content) return;
    const r = target.getBoundingClientRect();
    if (r.bottom > top - MARGIN) {
      content.scrollBy({ top: r.bottom - top + MARGIN * 2, behavior: "smooth" });
    } else if (r.top < content.getBoundingClientRect().top + MARGIN) {
      content.scrollBy({ top: r.top - content.getBoundingClientRect().top - MARGIN * 2 });
    }
  });
}

/**
 * Book mode: how far (px) to lift the text so `target` shows above the sheet where the sheet
 * is now (call it again as the sheet grows). Never so far that the word goes under the top of
 * `room` (the page's own box). 0 when it is clear; null without a sheet.
 */
export function liftAboveSheet(target: Element | null, room: Element | null): number | null {
  if (!target || !room || !isSheet()) return null;
  const top = sheetTop();
  if (top === null) return null;
  // The lift the text has at this moment (it may be moving), so the word's own place is known.
  const lifted = target.closest<HTMLElement>(".book-vp");
  const current = lifted ? -new DOMMatrixReadOnly(getComputedStyle(lifted).transform).m42 : 0;
  const r = target.getBoundingClientRect();
  const bottom = r.bottom + current;
  if (bottom <= top - MARGIN) return 0;
  const most = Math.max(0, r.top + current - room.getBoundingClientRect().top - 8);
  return Math.round(Math.min(most, bottom - top + MARGIN));
}
