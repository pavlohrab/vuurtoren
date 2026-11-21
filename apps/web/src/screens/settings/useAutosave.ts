import { useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Save `draft` a moment after the last change (Settings has no Save buttons). Nothing is
 * saved while `draft` is null (untouched) or `valid` is false. A change still waiting when the
 * section closes (another section, another page) or the app goes to the background is saved
 * right then, so leaving quickly never loses it.
 */
export function useAutosave<T>(
  draft: T | null,
  save: (value: T) => Promise<void>,
  { delay = 600, valid = true }: { delay?: number; valid?: boolean } = {},
): { status: SaveStatus; error: unknown } {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<unknown>(null);
  const saveRef = useRef(save);
  // The draft waiting for its moment (null once it is on its way).
  const pending = useRef<{ value: T } | null>(null);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (draft === null || !valid) {
      pending.current = null;
      return;
    }
    let cancelled = false;
    pending.current = { value: draft };
    const t = setTimeout(() => {
      pending.current = null;
      setStatus("saving");
      saveRef.current(draft).then(
        () => {
          if (!cancelled) {
            setError(null);
            setStatus("saved");
          }
        },
        (e: unknown) => {
          if (!cancelled) {
            setError(e);
            setStatus("error");
          }
        },
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft, delay, valid]);
  // Leaving: save what is still waiting at once.
  useEffect(() => {
    const flush = () => {
      const waiting = pending.current;
      pending.current = null;
      if (waiting) saveRef.current(waiting.value).catch(() => undefined);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, []);
  return { status, error };
}
