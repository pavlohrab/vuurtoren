import { useEffect, useMemo, useRef, useState } from "react";
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
  /**
   * A cloze was answered. `hints`: 0 none, 1 first letter + length shown, 2 revealed (gave up;
   * `answer` is then "").
   */
  onClozeAnswer?: (i: number, answer: string, hints: number) => void;
  /** Translations keyed by token index: inline in gloss mode, meaning hints on clozes. */
  glosses?: Readonly<Record<number, string>>;
  /** read: clozes shown as plain words; cloze/undefined: blanks; gloss: glosses shown inline. */
  mode?: ReaderMode;
  /** Show cloze blanks. Default: only in cloze mode (or when no mode is given). */
  blanks?: boolean;
  /**
   * Grammar spotlights: token index -> short description of the constructions it belongs to
   * (e.g. "Inversion · Separable verbs"). Those words get a quiet underline; clicking them still
   * calls `onTokenClick`.
   */
  spotlights?: ReadonlyMap<number, string>;
}

/** Letter hint: the first `shown` letters, then one underscore per remaining letter. */
export function letterHint(word: string, shown = 1): string {
  const chars = [...word];
  return chars.map((c, k) => (k < shown || !/\p{L}/u.test(c) ? c : "_")).join(" ");
}

/**
 * Cloze help ladder: 0 meaning (tooltip on focus) → 1 first letter → 2 first half → reveal.
 * `onClozeAnswer` receives the level used; a reveal is reported as answer "" with level 3.
 */
export const CLOZE_REVEAL_LEVEL = 3;
const HINT_TITLES = ["Show the first letter (?)", "Show half of the word (?)", "Show the word (?)"];

/** Opacity of the "learning" underline: fades as recall grows, clamped to 0.25..1. */
export function learningOpacity(pKnown: number): number {
  return Math.max(0.25, Math.min(1, 1 - pKnown));
}

/** Lower-case, NFC-normalised, trimmed form used to compare an answer with the word. */
const normalize = (s: string) => s.normalize("NFC").trim().toLocaleLowerCase();
/** Same, with diacritics removed ("een" matches "één"). */
const stripAccents = (s: string) =>
  normalize(s)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");

/**
 * How an answer compares with the target word. Matching is case-insensitive and
 * Unicode-normalised (NFC). Missing diacritics ("een" for "één", "cafe" for "café") count as
 * correct, because learners often type without them; the result is then "accents" so the UI
 * can add a quiet note. Anything else is "incorrect".
 */
export function matchAnswer(answer: string, target: string): "exact" | "accents" | "incorrect" {
  if (normalize(answer) === normalize(target)) return "exact";
  return stripAccents(answer) === stripAccents(target) ? "accents" : "incorrect";
}

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
  blanks,
  spotlights,
}: ReaderProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [hints, setHints] = useState<Record<number, number>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  // Token to focus after the next render (the answered word, when no blank follows).
  const focusAfterRender = useRef<number | null>(null);
  useEffect(() => {
    const i = focusAfterRender.current;
    if (i === null) return;
    focusAfterRender.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus();
  }, [answers]);

  const planned = useMemo(() => {
    const m = new Map<number, PlannedToken>();
    for (const p of plans) for (const t of p.tokens) m.set(t.i, t);
    return m;
  }, [plans]);

  const clickable = (t: AnalyzedToken) => {
    const p = planned.get(t.i);
    return p !== undefined && p.label !== "nonword" && t.is_word;
  };

  /**
   * Label to style a token with: detached particles borrow their verb's, except that a cloze
   * verb must not turn its particle into a second blank; the particle then keeps its own
   * planned label (a cloze one degrades to a plain known word).
   */
  const labelOf = (t: AnalyzedToken): TokenLabel => {
    const own = planned.get(t.i)?.label ?? "nonword";
    if (t.particle_of == null) return own;
    const verb = planned.get(t.particle_of)?.label ?? own;
    if (verb !== "cloze") return verb;
    return own === "cloze" ? "known" : own;
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

    const showBlanks = blanks ?? (mode === undefined || mode === "cloze");
    if (label === "cloze" && showBlanks) {
      const answer = answers[t.i];
      const hint = hints[t.i] ?? 0;
      const show = revealed?.has(t.i) === true || answer !== undefined;
      if (!show) {
        const advanceHint = () => {
          if (hint >= CLOZE_REVEAL_LEVEL - 1) {
            // last step = reveal (counts as not recalled)
            setAnswers((a) => ({ ...a, [t.i]: "" }));
            setHints((h) => ({ ...h, [t.i]: CLOZE_REVEAL_LEVEL }));
            onClozeAnswer?.(t.i, "", CLOZE_REVEAL_LEVEL);
          } else setHints((h) => ({ ...h, [t.i]: hint + 1 }));
        };
        const shownLetters = hint >= 2 ? Math.ceil([...surface].length / 2) : 1;
        const hintId = `k-cloze-hint-${t.i}`;
        return (
          <span key={t.i} className={cn("k-cloze-wrap", hint >= 1 && "k-cloze-wrap--pinned")}>
            {gloss ? (
              <span id={hintId} className="k-cloze-hint" role="tooltip" title={gloss}>
                {gloss}
              </span>
            ) : null}
            <input
              data-tok=""
              className="k-cloze"
              type="text"
              size={Math.max(3, surface.length + 1)}
              aria-label="Fill in the missing word (press ? for a hint)"
              {...(gloss ? { "aria-describedby": hintId } : {})}
              {...(hint >= 1 ? { placeholder: letterHint(surface, shownLetters) } : {})}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "?") {
                  e.preventDefault();
                  advanceHint();
                } else if (e.key === "Enter" && e.currentTarget.value.trim() !== "") {
                  const value = e.currentTarget.value.trim();
                  // Move on: the next blank if there is one, else the answered word.
                  const blanks = Array.from(
                    rootRef.current?.querySelectorAll<HTMLInputElement>("input.k-cloze") ?? [],
                  );
                  const next = blanks[blanks.indexOf(e.currentTarget) + 1];
                  if (next) next.focus();
                  else focusAfterRender.current = t.i;
                  setAnswers((a) => ({ ...a, [t.i]: value }));
                  onClozeAnswer?.(t.i, value, hint);
                }
              }}
            />
            <button
              type="button"
              className="k-cloze-hintbtn"
              tabIndex={-1}
              aria-label={(HINT_TITLES[hint] ?? "Show the word").replace(" (?)", "")}
              title={HINT_TITLES[hint] ?? "Show the word"}
              onClick={advanceHint}
            >
              ?
            </button>
          </span>
        );
      }
      const match = answer ? matchAnswer(answer, surface) : null;
      const result =
        answer === undefined
          ? undefined
          : answer === ""
            ? "revealed"
            : match === "incorrect"
              ? "incorrect"
              : "correct";
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
          {...(match === "accents"
            ? { "data-note": "accents", title: "Correct, but check the accents" }
            : gloss
              ? { title: gloss }
              : {})}
          onClick={() => onTokenClick?.(t.i)}
          onKeyDown={(e) => onKeyDown(e, t.i)}
        >
          {result === "incorrect" ? <s className="k-cloze-attempt">{answer}</s> : null}
          {surface}
        </span>
      );
    }

    // In read mode a cloze degrades to a plain (known/learning-style) word.
    const shownLabel: TokenLabel = label === "cloze" ? "known" : label;
    const spot = spotlights?.get(t.i);
    const title = gloss && mode === "gloss" ? (spot ? `${gloss} · ${spot}` : gloss) : spot;
    return (
      <span
        key={t.i}
        data-tok=""
        data-i={t.i}
        data-label={shownLabel}
        data-selected={isSelected}
        className={cn(
          "k-tok",
          t.particle_of != null && "k-tok--particle",
          spot !== undefined && "k-tok--spot",
        )}
        role="button"
        tabIndex={t.i === tabStop ? 0 : -1}
        {...(title ? { title } : {})}
        {...(spot ? { "aria-description": `Grammar: ${spot}` } : {})}
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
        {gloss && mode === "gloss" ? <sup className="k-gloss-mark">{gloss}</sup> : null}
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
