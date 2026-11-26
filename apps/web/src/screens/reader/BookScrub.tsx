/**
 * Book mode's scrub bar: drag along it to jump through the text's pages. A bubble shows the
 * page under the thumb; the reader goes there when it is let go, with one slide.
 */
import { useState } from "react";

export function BookScrub({
  pages,
  current,
  onJump,
}: {
  pages: number;
  /** The page shown now, from 0. */
  current: number;
  onJump: (page: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  if (pages < 2) return null;
  const value = drag ?? current + 1;
  const commit = () => {
    if (drag === null) return;
    setDrag(null);
    if (drag - 1 !== current) onJump(drag - 1);
  };
  // The bubble sits over the thumb: the share of the track, less the thumb's own width.
  const share = (value - 1) / (pages - 1);
  return (
    <div className="book-scrub">
      <input
        type="range"
        min={1}
        max={pages}
        step={1}
        value={value}
        aria-label="Page"
        aria-valuetext={`Page ${value} of ${pages}`}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {drag !== null ? (
        <output
          className="book-scrub-bubble"
          style={{ left: `calc(${share * 100}% + ${(0.5 - share) * 16}px)` }}
        >
          Page {drag}
        </output>
      ) : null}
    </div>
  );
}
