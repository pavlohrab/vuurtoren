import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { AnalyzedToken, PlannedToken, SegmentPlan, TokenLabel } from "@app/core";
import { cn } from "./cn.js";
import type { ReaderMode } from "./types.js";

export interface ReaderProps {
  /** Source text; whitespace between tokens is taken from here. */
  text: string;
  tokens: AnalyzedToken[];
  /** Plans for the segments to render (pass one for a single segment, all for the full text). */
  plans: SegmentPlan[];
  selectedToken?: number | null;
  /** Cloze tokens whose answer is shown. */
  revealed?: ReadonlySet<number>;
  onTokenClick?: (i: number) => void;
  onClozeAnswer?: (i: number, answer: string) => void;
  /** Optional inline glosses keyed by token index (shown as tooltip, and inline in gloss mode). */
  glosses?: Readonly<Record<number, string>>;
  /** read: clozes shown as plain words; cloze/undefined: blanks; gloss: glosses shown inline. */
  mode?: ReaderMode;
}

/** Opacity of the "learning" underline: fades as recall grows, clamped to 0.25..1. */
export function learningOpacity(pKnown: number): number {
  return Math.max(0.25, Math.min(1, 1 - pKnown));
}

const normalize = (s: string) => s.trim().toLocaleLowerCase();

/** Renders analysed text with word-state treatments, cloze blanks and keyboard navigation. */
export function Reader({
  text,
  tokens,
  plans,
  selectedToken = null,
  revealed,
  onTokenClick,
  onClozeAnswer,
  glosses,
  mode,
}: ReaderProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  const planned = useMemo(() => {
    const m = new Map<number, PlannedToken>();
    for (const p of plans) for (const t of p.tokens) m.set(t.i, t);
    return m;
  }, [plans]);

  const clickable = (t: AnalyzedToken) => {
    const p = planned.get(t.i);
    return p !== undefined && p.label !== "nonword" && t.is_word;
  };

  /** Label to style a token with: detached particles borrow their verb's. */
  const labelOf = (t: AnalyzedToken): TokenLabel => {
    const own = planned.get(t.i)?.label ?? "nonword";
    if (t.particle_of != null) return planned.get(t.particle_of)?.label ?? own;
    return own;
  };

  // The roving-tabindex anchor: the selected token, else the first clickable one.
  const firstClickable = tokens.find((t) => planned.has(t.i) && clickable(t))?.i ?? -1;
  const tabStop =
    selectedToken != null && planned.has(selectedToken) ? selectedToken : firstClickable;
  const selectedGroup = useMemo(() => {
    const s = new Set<number>();
    if (selectedToken == null) return s;
    s.add(selectedToken);
    const tok = tokens[selectedToken];
    if (tok?.particle_of != null) s.add(tok.particle_of);
    for (const t of tokens) if (t.particle_of === selectedToken) s.add(t.i);
    return s;
  }, [selectedToken, tokens]);

  const move = (from: HTMLElement, dir: 1 | -1) => {
    const els = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-tok]") ?? []);
    const next = els[els.indexOf(from) + dir];
    next?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, i: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onTokenClick?.(i);
    } else if (e.key === "ArrowRight" || e.key === "j") {
      e.preventDefault();
      move(e.currentTarget, 1);
    } else if (e.key === "ArrowLeft" || e.key === "k") {
      e.preventDefault();
      move(e.currentTarget, -1);
    }
  };

  const renderToken = (t: AnalyzedToken): ReactNode => {
    const p = planned.get(t.i);
    const surface = text.slice(t.start, t.end);
    if (!p || p.label === "nonword" || !t.is_word) return surface;

    const label = labelOf(t);
    const gloss = glosses?.[t.i];
    const isSelected = selectedGroup.has(t.i);

    if (label === "cloze" && mode !== "read") {
      const answer = answers[t.i];
      const show = revealed?.has(t.i) === true || answer !== undefined;
      if (!show) {
        return (
          <input
            key={t.i}
            data-tok=""
            className="k-cloze"
            type="text"
            size={Math.max(3, surface.length + 1)}
            aria-label="Fill in the missing word"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && e.currentTarget.value.trim() !== "") {
                const value = e.currentTarget.value.trim();
                setAnswers((a) => ({ ...a, [t.i]: value }));
                onClozeAnswer?.(t.i, value);
              }
            }}
          />
        );
      }
      const result =
        answer === undefined
          ? undefined
          : normalize(answer) === normalize(surface)
            ? "correct"
            : "incorrect";
      return (
        <span
          key={t.i}
          data-tok=""
          data-i={t.i}
          data-label="cloze"
          {...(result ? { "data-result": result } : {})}
          data-selected={isSelected}
          className="k-tok"
          role="button"
          tabIndex={t.i === tabStop ? 0 : -1}
          onClick={() => onTokenClick?.(t.i)}
          onKeyDown={(e) => onKeyDown(e, t.i)}
        >
          {surface}
        </span>
      );
    }

    // In read mode a cloze degrades to a plain (known/learning-style) word.
    const shownLabel: TokenLabel = label === "cloze" ? "known" : label;
    return (
      <span
        key={t.i}
        data-tok=""
        data-i={t.i}
        data-label={shownLabel}
        data-selected={isSelected}
        className={cn("k-tok", t.particle_of != null && "k-tok--particle")}
        role="button"
        tabIndex={t.i === tabStop ? 0 : -1}
        {...(gloss ? { title: gloss } : {})}
        {...(shownLabel === "learning"
          ? {
              style: {
                textDecorationColor: `color-mix(in srgb, var(--state-learning-line) ${Math.round(learningOpacity(p.pKnown) * 100)}%, transparent)`,
              },
            }
          : {})}
        onClick={() => onTokenClick?.(t.i)}
        onKeyDown={(e) => onKeyDown(e, t.i)}
      >
        {surface}
        {gloss && (shownLabel === "gloss" || mode === "gloss") ? (
          <sup className="k-gloss-mark">{mode === "gloss" ? gloss : "·"}</sup>
        ) : null}
      </span>
    );
  };

  // Build paragraphs from the tokens inside the planned region, keeping gaps from `text`.
  const buildParagraphs = (): ReactNode[][] => {
    const inRegion = tokens.filter((t) => planned.has(t.i));
    if (plans.length === 0 || inRegion.length === 0) {
      return text.split(/\n[ \t]*\n/).map((s) => [s] as ReactNode[]);
    }
    const regionStart = Math.min(...plans.map((p) => p.segment.charStart));
    const regionEnd = Math.max(...plans.map((p) => p.segment.charEnd));
    const out: ReactNode[][] = [[]];
    let cursor = regionStart;
    const addGap = (gap: string) => {
      if (!gap) return;
      const parts = gap.split(/\n[ \t]*\n\s*/);
      parts.forEach((part, idx) => {
        if (idx > 0) out.push([]);
        if (part) out[out.length - 1]?.push(part);
      });
    };
    for (const t of inRegion) {
      addGap(text.slice(cursor, t.start));
      out[out.length - 1]?.push(renderToken(t));
      cursor = t.end;
    }
    addGap(text.slice(cursor, regionEnd));
    return out.filter((nodes) => nodes.some((n) => (typeof n === "string" ? n.trim() : true)));
  };

  return (
    <div ref={rootRef} className="k-reader" lang="nl">
      {buildParagraphs().map((nodes, idx) => (
        <p key={idx}>{nodes}</p>
      ))}
    </div>
  );
}
