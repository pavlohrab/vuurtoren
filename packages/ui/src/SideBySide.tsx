import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import type {
  AnalyzedToken,
  PlannedToken,
  SegmentPlan,
  SentencePairs,
  TokenLabel,
} from "@app/core";
import { isCounted } from "@app/core";
import { cn } from "./cn.js";

/** When the English of a sentence shows in the side-by-side reader. */
export type EnglishVisibility = "always" | "hard" | "tap";

/** A short word-order note for the structure view ("Verb second" + one line). */
export interface StructureNote {
  label: string;
  note: string;
}

export interface SideBySideProps {
  /** Source text; whitespace between tokens is taken from here. */
  text: string;
  tokens: AnalyzedToken[];
  /** The plan of the page to show. */
  plan: SegmentPlan;
  /** English and word pairs by sentence number (`AnalyzedToken.sent`); missing = loading. */
  pairs?: ReadonlyMap<number, SentencePairs>;
  /** always; hard: only sentences with less than `hardBelow` known; tap: "Show English". */
  visibility?: EnglishVisibility;
  /** Coverage below which a sentence is hard (default 0.85). */
  hardBelow?: number;
  /** Word-order notes by sentence number, shown in the structure view. */
  notes?: ReadonlyMap<number, StructureNote>;
  selectedToken?: number | null;
  /** A Dutch word was chosen (opens the word inspector). */
  onTokenClick?: (i: number) => void;
  /** Something to show after each Dutch sentence (a play button), given its number and text. */
  sentenceAction?: (sent: number, text: string) => ReactNode;
}

/** The pair a word belongs to: its sentence and the pair's index there. */
interface PairRef {
  sent: number;
  pair: number;
}

/** Soft structure colours (`--pair-1` … `--pair-9` in styles.css). */
const PALETTE_SIZE = 9;

const same = (a: PairRef | null, b: PairRef | null) =>
  a !== null && b !== null && a.sent === b.sent && a.pair === b.pair;

interface Sentence {
  sent: number;
  tokens: AnalyzedToken[];
  /** Source text before the sentence's first token (inside the page). */
  before: string;
  coverage: number;
}

/**
 * Side by side: each sentence of the page with its English, matched sentence by sentence.
 * From 900px the Dutch and the English stand in two columns; narrower, the English sits under
 * each Dutch sentence. Hovering, focusing or clicking a word lights up its partner words on the
 * other side (a split separable verb lights up both parts); a Dutch word also opens the
 * inspector. The structure view colours every pair and adds a word-order note.
 */
export function SideBySide({
  text,
  tokens,
  plan,
  pairs,
  visibility = "hard",
  hardBelow = 0.85,
  notes,
  selectedToken = null,
  onTokenClick,
  sentenceAction,
}: SideBySideProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<PairRef | null>(null);
  const [pinned, setPinned] = useState<PairRef | null>(null);
  // Focus lights a pair only when the keyboard moved it; after a tap the tapped pair stays lit.
  const byKeyboard = useRef(false);
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  const [structure, setStructure] = useState<ReadonlySet<number>>(new Set());
  const active = hover ?? pinned;

  const planned = useMemo(() => new Map(plan.tokens.map((p) => [p.i, p])), [plan]);

  // The page's sentences in order, grouped into paragraphs at blank lines.
  const paragraphs = useMemo(() => {
    const out: Sentence[][] = [[]];
    let cursor = plan.segment.charStart;
    let cur: Sentence | null = null;
    for (const t of tokens) {
      if (!planned.has(t.i)) continue;
      if (cur === null || t.sent !== cur.sent) {
        const gap = text.slice(cursor, t.start);
        if (cur !== null && /\n[ \t]*\n/.test(gap)) out.push([]);
        cur = { sent: t.sent, tokens: [], before: gap, coverage: 1 };
        out[out.length - 1]?.push(cur);
      }
      cur.tokens.push(t);
      cursor = t.end;
    }
    for (const para of out) {
      for (const s of para) {
        let sum = 0;
        let n = 0;
        for (const t of s.tokens) {
          const p = planned.get(t.i);
          if (!p || !isCounted(t, p)) continue;
          sum += p.pKnown;
          n++;
        }
        s.coverage = n ? sum / n : 1;
      }
    }
    return out.filter((p) => p.length > 0);
  }, [tokens, planned, plan, text]);

  /** Dutch token -> its pair; English token per sentence -> its pair. */
  const index = useMemo(() => {
    const nl = new Map<number, PairRef>();
    const en = new Map<string, PairRef>();
    for (const [sent, s] of pairs ?? []) {
      s.pairs.forEach((p, k) => {
        for (const i of p.nl) nl.set(i, { sent, pair: k });
        for (const j of p.en) en.set(`${sent}:${j}`, { sent, pair: k });
      });
    }
    return { nl, en };
  }, [pairs]);

  const selectedGroup = useMemo(() => {
    const s = new Set<number>();
    if (selectedToken == null) return s;
    s.add(selectedToken);
    const tok = tokens[selectedToken];
    if (tok?.particle_of != null) s.add(tok.particle_of);
    for (const t of tokens) if (t.particle_of === selectedToken) s.add(t.i);
    return s;
  }, [selectedToken, tokens]);

  const firstWord = paragraphs.flat()[0]?.tokens.find((t) => t.is_word)?.i ?? -1;
  const tabStop =
    selectedToken != null && planned.has(selectedToken) && tokens[selectedToken]?.is_word
      ? selectedToken
      : firstWord;

  const toggle = (set: ReadonlySet<number>, n: number) => {
    const next = new Set(set);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    return next;
  };
  const toggleStructure = (sent: number) => {
    setStructure((s) => toggle(s, sent));
    setShown((s) => new Set(s).add(sent)); // the structure needs the English
  };

  /** Move the focus along one side (Dutch or English), or across to the partner. */
  const onKeyDown = (e: KeyboardEvent<HTMLElement>, side: "nl" | "en", ref: PairRef | null) => {
    const root = rootRef.current;
    if (!root) return;
    if (["ArrowRight", "ArrowLeft", "j", "k"].includes(e.key)) {
      e.preventDefault();
      const all = Array.from(root.querySelectorAll<HTMLElement>(`[data-side="${side}"]`));
      const dir = e.key === "ArrowRight" || e.key === "j" ? 1 : -1;
      all[all.indexOf(e.currentTarget) + dir]?.focus();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && ref) {
      // To the partner on the other side.
      e.preventDefault();
      const other = side === "nl" ? "en" : "nl";
      root
        .querySelector<HTMLElement>(
          `[data-side="${other}"][data-sent="${ref.sent}"][data-pair="${ref.pair}"]`,
        )
        ?.focus();
    }
  };

  const pairHandlers = (ref: PairRef | null) =>
    ref
      ? {
          // A mouse only: after a tap a phone sends mouse events too, and once the page
          // scrolls (the word sheet opening) they would light whatever word is under the
          // finger's old place instead of the tapped one (which stays pinned).
          onPointerEnter: (e: PointerEvent) => {
            if (e.pointerType === "mouse") setHover(ref);
          },
          onPointerLeave: (e: PointerEvent) => {
            if (e.pointerType === "mouse") setHover(null);
          },
          onFocus: () => {
            if (byKeyboard.current) setHover(ref);
          },
          onBlur: () => setHover(null),
        }
      : {};

  const pairAttrs = (ref: PairRef | null, structured: boolean) =>
    ref
      ? {
          "data-pair": ref.pair,
          ...(same(ref, active) ? { "data-active": "" } : {}),
          ...(structured ? { "data-pc": (ref.pair % PALETTE_SIZE) + 1 } : {}),
        }
      : {};

  const englishOf = (ref: PairRef) => {
    const s = pairs?.get(ref.sent);
    const p = s?.pairs[ref.pair];
    return p ? p.en.map((j) => s.englishTokens[j]?.text ?? "").join(" ") : "";
  };
  const dutchOf = (ref: PairRef) =>
    (pairs?.get(ref.sent)?.pairs[ref.pair]?.nl ?? []).map((i) => tokens[i]?.text ?? "").join(" ");

  const labelOf = (t: AnalyzedToken, p: PlannedToken): TokenLabel => {
    const verb = t.particle_of != null ? planned.get(t.particle_of)?.label : undefined;
    const label = verb ?? p.label;
    return label === "cloze" ? "known" : label;
  };

  const renderDutch = (s: Sentence, structured: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let cursor = s.tokens[0]?.start ?? 0;
    for (const t of s.tokens) {
      const gap = text.slice(cursor, t.start);
      if (gap) out.push(gap);
      cursor = t.end;
      const p = planned.get(t.i);
      const surface = text.slice(t.start, t.end);
      if (!p || !t.is_word || p.label === "nonword") {
        out.push(surface);
        continue;
      }
      const ref = index.nl.get(t.i) ?? null;
      const en = ref ? englishOf(ref) : "";
      out.push(
        <button
          key={t.i}
          type="button"
          className={cn("k-tok k-sbs-w", t.particle_of != null && "k-tok--particle")}
          data-tok=""
          data-side="nl"
          data-i={t.i}
          data-sent={s.sent}
          data-label={labelOf(t, p)}
          data-selected={selectedGroup.has(t.i)}
          tabIndex={t.i === tabStop ? 0 : -1}
          {...(en ? { "aria-label": `${surface} (English: ${en})` } : {})}
          {...pairAttrs(ref, structured)}
          {...pairHandlers(ref)}
          onClick={(e: MouseEvent) => {
            if (e.altKey) {
              toggleStructure(s.sent);
              return;
            }
            if (ref) setPinned(ref);
            onTokenClick?.(t.i);
          }}
          onKeyDown={(e) => onKeyDown(e, "nl", ref)}
        >
          {surface}
        </button>,
      );
    }
    return out;
  };

  const renderEnglish = (s: Sentence, sp: SentencePairs, structured: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let cursor = 0;
    sp.englishTokens.forEach((et, j) => {
      const gap = sp.english.slice(cursor, et.start);
      if (gap) out.push(gap);
      cursor = et.end;
      const ref = index.en.get(`${s.sent}:${j}`) ?? null;
      if (!ref) {
        out.push(et.text);
        return;
      }
      out.push(
        <button
          key={j}
          type="button"
          className="k-sbs-w k-sbs-en-w"
          data-side="en"
          data-sent={s.sent}
          tabIndex={-1}
          aria-label={`${et.text} (Dutch: ${dutchOf(ref)})`}
          aria-pressed={same(ref, pinned)}
          {...pairAttrs(ref, structured)}
          {...pairHandlers(ref)}
          onClick={() => setPinned((cur) => (same(cur, ref) ? null : ref))}
          onKeyDown={(e) => onKeyDown(e, "en", ref)}
        >
          {et.text}
        </button>,
      );
    });
    const rest = sp.english.slice(cursor);
    if (rest) out.push(rest);
    return out;
  };

  const renderRow = (s: Sentence): ReactNode => {
    const sp = pairs?.get(s.sent);
    const hard = s.coverage < hardBelow;
    const visible = visibility === "always" || (visibility === "hard" && hard) || shown.has(s.sent);
    const structured = structure.has(s.sent) && visible && !!sp?.english;
    const note = notes?.get(s.sent);
    const noteId = `k-sbs-note-${s.sent}`;
    let english: ReactNode;
    if (!visible) {
      english = (
        <button
          type="button"
          className="k-sbs-show"
          onClick={() => setShown((cur) => new Set(cur).add(s.sent))}
        >
          Show English
        </button>
      );
    } else if (!sp) {
      english = <span className="k-sbs-wait" aria-label="Translating" />;
    } else if (!sp.english) {
      english = <span className="k-sbs-none">No translation for this sentence.</span>;
    } else {
      english = (
        <span
          className="k-sbs-en-text"
          {...(sp.source === "ai"
            ? { title: "Translated by your AI provider" }
            : sp.source === "story"
              ? { title: "The story's own translation" }
              : {})}
        >
          {renderEnglish(s, sp, structured)}
        </span>
      );
    }
    return (
      <div
        key={s.sent}
        className="k-sbs-row"
        data-sent={s.sent}
        {...(structured ? { "data-structure": "" } : {})}
        {...(hard ? { "data-hard": "" } : {})}
      >
        <p className="k-sbs-nl" lang="nl">
          {renderDutch(s, structured)}
          {sentenceAction && s.tokens.length
            ? sentenceAction(
                s.sent,
                text.slice(s.tokens[0]!.start, s.tokens[s.tokens.length - 1]!.end),
              )
            : null}
        </p>
        <div className="k-sbs-en" lang="en">
          {english}
        </div>
        {visible && sp?.english ? (
          <button
            type="button"
            className="k-sbs-struct"
            aria-pressed={structured}
            {...(structured && note ? { "aria-describedby": noteId } : {})}
            title={
              structured
                ? "Hide the structure (Alt-click a word)"
                : "Show the structure (Alt-click a word)"
            }
            onClick={() => toggleStructure(s.sent)}
          >
            Structure
          </button>
        ) : null}
        {structured ? (
          <p className="k-sbs-note" id={noteId}>
            {note ? (
              <>
                <strong>{note.label}.</strong> {note.note}
              </>
            ) : (
              "Each colour is one pair: the Dutch words and the English they became."
            )}
          </p>
        ) : null}
      </div>
    );
  };

  // The box is a size container: the two columns follow the width the reader really has
  // (beside the sidebar and the word panel), not the window's.
  return (
    <div className="k-sbs-box">
      <div
        ref={rootRef}
        className="k-sbs"
        onMouseLeave={() => setHover(null)}
        onKeyDownCapture={() => {
          byKeyboard.current = true;
        }}
        onPointerDownCapture={() => {
          byKeyboard.current = false;
        }}
        aria-describedby="k-sbs-help"
      >
        <p id="k-sbs-help" className="k-sr">
          Each Dutch sentence with its English. Arrow keys move along a side; up and down jump to
          the partner word on the other side.
        </p>
        {paragraphs.map((para, k) => (
          <div key={k} className="k-sbs-para">
            {para.map(renderRow)}
          </div>
        ))}
      </div>
    </div>
  );
}
