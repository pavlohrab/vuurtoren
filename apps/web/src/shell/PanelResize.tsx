/**
 * Resizable side panels on a computer (m5, UI2): drag the edge of the sidebar or of the word
 * panel, or focus it and use the arrow keys; a double click puts it back. The width is kept per
 * device. Below 900px the word panel is a bottom sheet and the sidebar a tab bar: no handles.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { readLocal, writeLocal } from "../storage/local.js";

export interface PanelSize {
  width: number;
  set: (w: number) => void;
  reset: () => void;
  min: number;
  max: number;
}

const clamp = (w: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, w)));

/** A panel width kept in this device's storage under `key`. */
export function usePanelWidth(key: string, initial: number, min: number, max: number): PanelSize {
  const [width, setWidth] = useState(() => {
    const saved = Number(readLocal(key));
    return Number.isFinite(saved) && saved > 0 ? clamp(saved, min, max) : initial;
  });
  const set = useCallback(
    (w: number) => {
      const next = clamp(w, min, max);
      setWidth(next);
      writeLocal(key, String(next));
    },
    [key, min, max],
  );
  const reset = useCallback(() => {
    setWidth(initial);
    writeLocal(key, null);
  }, [key, initial]);
  return { width, set, reset, min, max };
}

/**
 * The drag strip on a panel's edge. `grows` says which way widens the panel: "right" for the
 * sidebar (its handle is on its right edge), "left" for the word panel (handle on its left).
 */
export function ResizeHandle({
  size,
  grows,
  label,
  onResizing,
}: {
  size: PanelSize;
  grows: "left" | "right";
  label: string;
  onResizing?: (on: boolean) => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const sign = grows === "right" ? 1 : -1;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: size.width };
    onResizing?.(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (s) size.set(s.w + sign * (e.clientX - s.x));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onResizing?.(false);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") size.set(size.width - sign * step);
    else if (e.key === "ArrowRight") size.set(size.width + sign * step);
    else if (e.key === "Home") size.set(size.min);
    else if (e.key === "End") size.set(size.max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={`panel-resize panel-resize--${grows === "right" ? "end" : "start"}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={size.width}
      aria-valuemin={size.min}
      aria-valuemax={size.max}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={size.reset}
      onKeyDown={key}
    />
  );
}
