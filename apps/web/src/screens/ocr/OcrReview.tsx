import { type MenuItem, MenuButton } from "../library/MenuButton.js";
import { ChevronLeft, ChevronRight, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@app/ui";
import {
  type ReviewFlag,
  type ReviewImage,
  type ReviewState,
  fixFlag,
  keepFlag,
  nextOpen,
  openCount,
  rebase,
  reopenFlag,
  reviewText,
  shownWord,
} from "../../services/ocrReview.js";
import "./ocrReview.css";

const REASON: Record<ReviewFlag["reason"], string> = {
  unknown: "Not a Dutch word",
  hyphen: "Word split over a line end",
  confusable: "Often a misreading",
  low: "Unclear in the scan",
};

/** Natural size of an image (from the props when known, else measured once loaded). */
function useImageSize(img: ReviewImage | null | undefined): { w: number; h: number } | null {
  const [measured, setMeasured] = useState<{ src: string; w: number; h: number } | null>(null);
  const src = img?.src;
  useEffect(() => {
    if (!src || (img?.width && img.height)) return;
    const el = new Image();
    el.onload = () => setMeasured({ src, w: el.naturalWidth, h: el.naturalHeight });
    el.src = src;
  }, [src, img?.width, img?.height]);
  if (img?.width && img.height) return { w: img.width, h: img.height };
  return measured && measured.src === src ? { w: measured.w, h: measured.h } : null;
}

/** The scan around one word, enlarged: a CSS crop of the page picture. */
function WordCrop({ flag, img }: { flag: ReviewFlag; img: ReviewImage | null | undefined }) {
  const size = useImageSize(img);
  if (img === undefined) return <div className="ocr-crop ocr-crop--empty" aria-hidden />;
  if (!img || !size) return null;
  const { x, y, w, h } = flag.box;
  const padX = Math.max(0.03, w * 0.35);
  const padY = h * 0.9;
  const cx = Math.max(0, x - padX);
  const cy = Math.max(0, y - padY);
  const cw = Math.min(1 - cx, w + 2 * padX);
  const ch = Math.min(1 - cy, h + 2 * padY);
  const ratio = (cw * size.w) / (ch * size.h);
  return (
    <div
      className="ocr-crop"
      role="img"
      aria-label={`The scan of “${flag.word}”`}
      style={{
        aspectRatio: String(ratio),
        backgroundImage: `url("${img.src}")`,
        backgroundSize: `${100 / cw}% auto`,
        backgroundPosition: `${cw < 1 ? (cx / (1 - cw)) * 100 : 0}% ${
          ch < 1 ? (cy / (1 - ch)) * 100 : 0
        }%`,
      }}
    />
  );
}

/** The page picture with a quiet frame around the chosen word. */
function PageView({ flag, img }: { flag: ReviewFlag | undefined; img: ReviewImage | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const size = useImageSize(img);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !flag || !size) return;
    const shownHeight = (el.clientWidth / size.w) * size.h;
    el.scrollTop = Math.max(0, flag.box.y * shownHeight - el.clientHeight / 2);
  }, [flag, size]);
  if (!img) return null;
  return (
    <div className="ocr-page" ref={scroller}>
      <div className="ocr-page__frame">
        <img src={img.src} alt="The scanned page" />
        {flag ? (
          <span
            className="ocr-page__mark"
            aria-hidden
            style={{
              left: `${flag.box.x * 100}%`,
              top: `${flag.box.y * 100}%`,
              width: `${flag.box.w * 100}%`,
              height: `${flag.box.h * 100}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

export interface OcrReviewProps {
  value: ReviewState;
  onChange: (next: ReviewState) => void;
  /** Picture of a page: undefined while it loads, null when there is none. */
  image: (page: number) => ReviewImage | null | undefined;
  /** Offer "Edit the whole text" (a plain text box). */
  allowTextEdit?: boolean;
  /** The buttons in the bar above the text: Cancel and the one primary. */
  actions: ReactNode;
  /** Less used actions, in a "…" menu before them (Accept all suggestions, Skip review). */
  more?: MenuItem[];
  /** Shown before the count of words to check, e.g. "Page 12 · ". */
  label?: ReactNode;
}

/**
 * Review of OCR'd text: the page picture beside the text (stacked on phones), words that may be
 * misread underlined; choosing one shows the scan around it and suggestions to take, a box to
 * type the word, or "Keep". Keys: ← → move between the words, 1–3 take a suggestion, E edits,
 * K keeps.
 */
export function OcrReview({
  value,
  onChange,
  image,
  allowTextEdit = false,
  actions,
  more = [],
  label,
}: OcrReviewProps) {
  const [active, setActive] = useState(() => Math.max(0, nextOpen(value, -1, 1)));
  const [draft, setDraft] = useState<string | null>(null);
  const [editingAll, setEditingAll] = useState<string | null>(null);
  const flagEls = useRef(new Map<number, HTMLSpanElement>());
  const input = useRef<HTMLInputElement>(null);
  const flag = value.flags[active];
  const left = openCount(value);
  const pageImg = image(flag?.box.page ?? 1) ?? null;

  // A new text (the next course page): start at its first open word.
  const textRef = useRef(value.text);
  useEffect(() => {
    if (textRef.current === value.text) return;
    textRef.current = value.text;
    setActive(Math.max(0, nextOpen(value, -1, 1)));
    setDraft(null);
  }, [value]);

  const go = (i: number, focus = true) => {
    if (i < 0) return;
    setActive(i);
    setDraft(null);
    if (focus) {
      const el = flagEls.current.get(i);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest" });
    }
  };
  const total = value.flags.length;
  /** To the next/previous open word; once all are decided, simply to the neighbour. */
  const step = (dir: 1 | -1) => {
    const i = nextOpen(value, active, dir);
    if (i >= 0) go(i);
    else if (total > 0) go((active + dir + total) % total);
  };
  const decide = (next: ReviewState) => {
    onChange(next);
    setDraft(null);
    const after = nextOpen(next, active, 1);
    if (after >= 0) go(after);
  };
  const take = (s: string) => decide(fixFlag(value, active, s));

  useEffect(() => {
    if (editingAll !== null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        step(e.key === "ArrowRight" ? 1 : -1);
      } else if (/^[1-3]$/.test(e.key) && flag) {
        const s = flag.suggestions[Number(e.key) - 1];
        if (s) {
          e.preventDefault();
          take(s);
        }
      } else if ((e.key === "e" || e.key === "E") && flag) {
        e.preventDefault();
        setDraft(shownWord(value, flag));
        requestAnimationFrame(() => input.current?.select());
      } else if ((e.key === "k" || e.key === "K") && flag) {
        e.preventDefault();
        decide(keepFlag(value, active));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Text split around the flags (the original text with each flag's current word).
  const parts = useMemo(() => {
    const out: ({ kind: "text"; s: string } | { kind: "flag"; i: number })[] = [];
    let at = 0;
    value.flags.forEach((f, i) => {
      out.push({ kind: "text", s: value.text.slice(at, f.start) }, { kind: "flag", i });
      at = f.end;
    });
    out.push({ kind: "text", s: value.text.slice(at) });
    return out;
  }, [value]);

  const menu: MenuItem[] = [
    ...(allowTextEdit && editingAll === null
      ? [{ label: "Edit the whole text", onSelect: () => setEditingAll(reviewText(value)) }]
      : []),
    ...more,
  ];

  const summary =
    total === 0
      ? "Nothing to check."
      : left === 0
        ? `All ${total} words checked.`
        : `${left} ${left === 1 ? "word" : "words"} to check`;

  return (
    <div className="ocr-review">
      <div className="ocr-review__bar">
        <p className="ocr-review__summary" role="status">
          {label}
          {summary}
        </p>
        <div className="ocr-review__actions">
          {menu.length ? (
            <MenuButton label="More for this text" items={menu} className="ocr-review__more" />
          ) : null}
          {actions}
        </div>
      </div>

      <div className="ocr-review__grid" data-picture={pageImg ? true : undefined}>
        {pageImg ? (
          <div className="ocr-review__page">
            <PageView flag={flag} img={pageImg} />
          </div>
        ) : null}

        <div className="ocr-review__text">
          {editingAll !== null ? (
            <div className="stack">
              <textarea
                className="k-textarea ocr-review__textarea"
                aria-label="Recognised text"
                value={editingAll}
                rows={16}
                onChange={(e) => setEditingAll(e.target.value)}
              />
              <div className="row">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const next = rebase(value, editingAll);
                    onChange(next);
                    setEditingAll(null);
                    setActive(Math.max(0, nextOpen(next, -1, 1)));
                  }}
                >
                  Done editing
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingAll(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              {flag ? (
                <div className="ocr-word" aria-label="Chosen word">
                  <WordCrop flag={flag} img={image(flag.box.page)} />
                  <div className="ocr-word__head">
                    <span>
                      <span className="ocr-word__read">{shownWord(value, flag)}</span>
                      <span className="ocr-word__why">
                        {flag.status === "fixed"
                          ? `Changed from “${value.text.slice(flag.start, flag.end)}”`
                          : flag.status === "kept"
                            ? "Kept as recognised"
                            : REASON[flag.reason]}
                      </span>
                    </span>
                    <span className="ocr-word__nav">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon
                        aria-label="Previous word to check"
                        onClick={() => step(-1)}
                      >
                        <ChevronLeft size={16} aria-hidden />
                      </Button>
                      <span className="ocr-word__pos">
                        {active + 1} / {total}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon
                        aria-label="Next word to check"
                        onClick={() => step(1)}
                      >
                        <ChevronRight size={16} aria-hidden />
                      </Button>
                    </span>
                  </div>
                  {flag.status === "open" ? (
                    draft === null ? (
                      <div className="ocr-word__choices">
                        {flag.suggestions.map((s, k) => (
                          <Button key={s} size="sm" variant="secondary" onClick={() => take(s)}>
                            {s}
                            <kbd aria-hidden>{k + 1}</kbd>
                          </Button>
                        ))}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDraft(shownWord(value, flag));
                            requestAnimationFrame(() => input.current?.select());
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => decide(keepFlag(value, active))}
                        >
                          Keep
                        </Button>
                      </div>
                    ) : (
                      <form
                        className="ocr-word__choices"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (draft.trim()) take(draft.trim());
                        }}
                      >
                        <input
                          ref={input}
                          className="k-input ocr-word__input"
                          aria-label="Correct word"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setDraft(null);
                              flagEls.current.get(active)?.focus();
                            }
                          }}
                        />
                        <Button size="sm" variant="secondary" type="submit">
                          Use
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                          Cancel
                        </Button>
                      </form>
                    )
                  ) : (
                    <div className="ocr-word__choices">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onChange(reopenFlag(value, active))}
                      >
                        <Undo2 size={14} aria-hidden /> Undo
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="ocr-review__prose" lang="nl">
                {parts.map((p, k) =>
                  p.kind === "text" ? (
                    <span key={k}>{p.s}</span>
                  ) : (
                    // A span, not a <button>: a button is always an inline block, and a flag
                    // can span a line or paragraph break (a split hyphenation).
                    <span
                      key={k}
                      role="button"
                      tabIndex={0}
                      ref={(el) => {
                        if (el) flagEls.current.set(p.i, el);
                        else flagEls.current.delete(p.i);
                      }}
                      className="ocr-flag"
                      data-status={value.flags[p.i]?.status}
                      data-active={p.i === active || undefined}
                      aria-pressed={p.i === active}
                      onClick={() => go(p.i, false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          go(p.i, false);
                        }
                      }}
                    >
                      {value.flags[p.i] ? shownWord(value, value.flags[p.i] as ReviewFlag) : null}
                    </span>
                  ),
                )}
              </div>
              {total > 0 ? (
                <p className="ocr-review__keys">
                  <kbd>←</kbd> <kbd>→</kbd> move between words · <kbd>1</kbd>–<kbd>3</kbd> take a
                  suggestion · <kbd>E</kbd> edit · <kbd>K</kbd> keep
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
