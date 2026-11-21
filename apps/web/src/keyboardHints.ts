/**
 * Keyboard hints (key caps, "Keys: …" lines) show with a mouse and keyboard; on a touch screen
 * they wait until a hardware keyboard is used. The first key press from one marks the page
 * (`html[data-keyboard]`, styles.css). A soft keyboard does not count: it types into a field and
 * reports keys as "Unidentified" (229) while composing.
 */
function fromHardware(e: KeyboardEvent): boolean {
  if (e.isComposing || e.keyCode === 229 || e.key === "Unidentified" || !e.key) return false;
  const t = e.target as HTMLElement | null;
  const editable =
    !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ""));
  // In a field only keys a soft keyboard has no use for say a keyboard is there.
  return !editable || /^(Escape|Tab|Arrow|F\d|Page|Home|End)/.test(e.key);
}

/** Watch for a hardware keyboard; returns the removal. */
export function watchKeyboard(root: HTMLElement = document.documentElement): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!fromHardware(e)) return;
    root.dataset["keyboard"] = "";
    window.removeEventListener("keydown", onKey, true);
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
