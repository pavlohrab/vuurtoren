/**
 * Below 900px the inspector is a bottom sheet. After selecting a word, scroll the content so
 * the word sits above the sheet instead of under it. Runs after the sheet has laid out.
 */
export function revealAboveSheet(target: Element | null): void {
  if (!target || typeof window.matchMedia !== "function") return;
  if (!window.matchMedia("(max-width: 899px)").matches) return;
  requestAnimationFrame(() => {
    const sheet = document.querySelector(".inspector-panel");
    const content = document.getElementById("content");
    if (!sheet || !content) return;
    // Where the sheet comes to rest (it may still be sliding up): its bottom edge is fixed.
    const bottom = sheet.getBoundingClientRect().bottom;
    const slide = new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;
    const top = bottom - slide - (sheet as HTMLElement).offsetHeight;
    const r = target.getBoundingClientRect();
    const margin = 24;
    if (r.bottom > top - margin) {
      content.scrollBy({ top: r.bottom - top + margin * 2, behavior: "smooth" });
    } else if (r.top < content.getBoundingClientRect().top + margin) {
      content.scrollBy({ top: r.top - content.getBoundingClientRect().top - margin * 2 });
    }
  });
}
