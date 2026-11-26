/**
 * The Sentence tab (F3): the Dutch, its English and the sentence part by part, linked. Tap a word
 * in the Dutch, the English or the parts and it lights up with its partner words on the other
 * side, in side by side's colours. Ctrl-click, or a long press on the phone, adds the next word in
 * the next colour; tapping a marked word again clears it.
 */
import { LONG_PRESS_MS } from "../../platform/useLongPress.js";
import type { AnalyzedToken, SentencePairs } from "@app/core";
import { type MouseEvent, type PointerEvent, useCallback, useMemo, useRef, useState } from "react";
import type { SentenceGrammar } from "../ReaderAI.js";
import { SentencePanel } from "../ReaderAI.js";
import { SentenceFrameView } from "./SentenceFrameView.js";

const COLOURS = 9;

/** What a word's button needs to tell a tap from Ctrl-click or a long press. */
export interface PickHandlers {
  onClick: (e: MouseEvent) => void;
  onPointerDown: (e: PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: MouseEvent) => void;
}

/** Tap = pick one; Ctrl/⌘-click or a long press (touch) = add one more. */
function usePick(onPick: (key: number, add: boolean) => void) {
  const timer = useRef<number | null>(null);
  const long = useRef(false);
  const touch = useRef(false);
  /** The long press already picked the word: the click that may follow it does nothing. */
  const done = useRef(false);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return useCallback(
    (key: number): PickHandlers => ({
      onClick: (e) => {
        if (done.current) {
          done.current = false;
          return;
        }
        const add = e.ctrlKey || e.metaKey || long.current;
        long.current = false;
        onPick(key, add);
      },
      onPointerDown: (e) => {
        long.current = false;
        done.current = false;
        touch.current = e.pointerType !== "mouse";
        if (!touch.current) return;
        clear();
        timer.current = window.setTimeout(() => {
          long.current = true;
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS);
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      // Android answers a long press with the context menu (and would select the text): on a
      // touch screen that is the long press, so it adds the word, with no menu.
      onContextMenu: (e) => {
        if (!touch.current && !long.current) return;
        e.preventDefault();
        clear();
        long.current = false;
        done.current = true;
        onPick(key, true);
      },
    }),
    [onPick],
  );
}

/** A finger, not a mouse: the hint says long press instead of Ctrl + click. */
function touchScreen(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

interface Mark {
  /** A Dutch token; its pair (if any) lights up with it. */
  i: number;
  colour: number;
}

export function SentenceTab({
  tokens,
  sent,
  text,
  sentence,
  translation,
  pairs,
  grammar,
  onFocusTopic,
}: {
  tokens: readonly AnalyzedToken[];
  sent: number;
  /** The text's content (words are slices of it). */
  text: string;
  sentence: string;
  translation?: string | null | undefined;
  /** The sentence's English and word pairs; without them only the Dutch side lights up. */
  pairs?: SentencePairs | undefined;
  grammar: SentenceGrammar[];
  onFocusTopic?: (id: string) => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const pairOf = useCallback(
    (i: number) => pairs?.pairs.find((p) => p.nl.includes(i)) ?? null,
    [pairs],
  );
  const words = useMemo(() => tokens.filter((t) => t.sent === sent), [tokens, sent]);

  const pick = useCallback(
    (i: number, add: boolean) =>
      setMarks((cur) => {
        const p = pairOf(i);
        const same = (m: Mark) => m.i === i || (!!p && p.nl.includes(m.i));
        const hit = cur.find(same);
        if (!add) return hit && cur.length === 1 ? [] : [{ i, colour: 1 }];
        if (hit) return cur.filter((m) => m !== hit);
        const used = new Set(cur.map((m) => m.colour));
        let colour = 1;
        while (used.has(colour) && colour < COLOURS) colour++;
        if (used.has(colour)) colour = (cur.length % COLOURS) + 1;
        return [...cur, { i, colour }];
      }),
    [pairOf],
  );
  const bindNl = usePick(pick);
  // An English word picks the Dutch word it pairs with.
  const pickEn = useCallback(
    (k: number, add: boolean) => {
      const p = pairs?.pairs.find((x) => x.en.includes(k));
      if (p?.nl[0] !== undefined) pick(p.nl[0], add);
    },
    [pairs, pick],
  );
  const bindEn = usePick(pickEn);

  const { nlColour, enColour } = useMemo(() => {
    const nl = new Map<number, number>();
    const en = new Map<number, number>();
    for (const m of marks) {
      const p = pairOf(m.i);
      for (const i of p?.nl ?? [m.i]) nl.set(i, m.colour);
      for (const k of p?.en ?? []) en.set(k, m.colour);
    }
    return { nlColour: nl, enColour: en };
  }, [marks, pairOf]);

  const dutch = words.length ? (
    <p lang="nl">
      {words.map((t, n) => {
        const gap = n ? text.slice(words[n - 1]!.end, t.start) : "";
        const word = text.slice(t.start, t.end);
        const c = nlColour.get(t.i);
        return (
          <span key={t.i}>
            {gap}
            {t.pos === "PUNCT" || t.pos === "SPACE" ? (
              word
            ) : (
              <button
                type="button"
                className="k-sbs-w"
                {...(c ? { "data-pc": c } : {})}
                aria-pressed={c !== undefined}
                {...bindNl(t.i)}
              >
                {word}
              </button>
            )}
          </span>
        );
      })}
    </p>
  ) : (
    <p lang="nl">{sentence}</p>
  );

  const english =
    pairs && pairs.english ? (
      <p lang="en">
        {pairs.englishTokens.map((w, k) => {
          const gap = k ? pairs.english.slice(pairs.englishTokens[k - 1]!.end, w.start) : "";
          const c = enColour.get(k);
          const paired = pairs.pairs.some((p) => p.en.includes(k));
          return (
            <span key={k}>
              {gap}
              {paired ? (
                <button
                  type="button"
                  className="k-sbs-w"
                  {...(c ? { "data-pc": c } : {})}
                  aria-pressed={c !== undefined}
                  {...bindEn(k)}
                >
                  {w.text}
                </button>
              ) : (
                w.text
              )}
            </span>
          );
        })}
      </p>
    ) : translation ? (
      <p lang="en">{translation}</p>
    ) : null;

  return (
    <SentencePanel
      sentence={sentence}
      grammar={grammar}
      {...(onFocusTopic ? { onFocusTopic } : {})}
      text={
        <div className="sentence-panel-text k-pairs">
          {dutch}
          {english}
          {english && pairs?.pairs.length ? (
            <p className="k-pairs-hint">
              {touchScreen() ? "Long press" : "Ctrl + click"} to mark more words.
            </p>
          ) : null}
        </div>
      }
      frame={
        <SentenceFrameView
          tokens={tokens}
          sent={sent}
          text={text}
          marked={nlColour}
          bindWord={bindNl}
        />
      }
    />
  );
}
