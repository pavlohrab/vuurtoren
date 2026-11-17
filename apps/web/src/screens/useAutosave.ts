import { useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Save `draft` a moment after the last change (Settings has no Save buttons, U17). Nothing is
 * saved while `draft` is null (untouched) or `valid` is false.
 */
export function useAutosave<T>(
  draft: T | null,
  save: (value: T) => Promise<void>,
  { delay = 600, valid = true }: { delay?: number; valid?: boolean } = {},
): { status: SaveStatus; error: unknown } {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<unknown>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (draft === null || !valid) return;
    let cancelled = false;
    const t = setTimeout(() => {
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
  return { status, error };
}
