import { grammarLevel, levelsLine, roughTextLevel, starterRanks } from "../services/textLevel.js";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ModeMenu } from "./reader/ModeMenu.js";
import { useSwipePages } from "./reader/useSwipePages.js";
import { type BookHandle, BookPages, type BookScreen } from "./reader/BookPages.js";
import { BookScrub } from "./reader/BookScrub.js";
import { DEFAULT_WPM, minutesFor, nextWpm } from "./reader/bookMath.js";
import { takeVolumeKeys } from "../platform/volumeKeys.js";
import { formLine } from "./reader/formLine.js";
import { useWordCard } from "./reader/useWordCard.js";
import {
  type HelpLevel,
  type SegmentPlan,
  relabelKey,
  glossTargets,
  helpLevel,
  hitsInSentence,
  textDifficulty,
  wordOrderNote,
} from "@app/core";
import { type GrammarTopic, grammarTopic } from "@app/content";
import {
  AnchoredPopover,
  Button,
  EmptyState,
  Reader,
  type ReaderMode,
  SideBySide,
  Skeleton,
  type StructureNote,
  Tabs,
  WordInspector,
  matchAnswer,
  useToast,
} from "@app/ui";
import { useServices } from "../services/context.js";
import { storySlugOf } from "../services/stories.js";
import type { InspectorEntry, ReadingView } from "../services/types.js";
import { notesFor } from "./GrammarNotes.js";
import {
  type MarginMark,
  hitsForTopic,
  levelFromVocabulary,
  marginMarks,
  noteRecentTopic,
  readRecentTopics,
  topicPriority,
  topicsInText,
} from "./reader/grammarMarks.js";
import { FocusChip, MarkCard } from "./reader/ReaderGrammar.js";
import { type MenuView, ReaderMenu, ShortcutsDialog } from "./reader/ReaderMenu.js";
import { TextDetailsDialog } from "./library/TextDetailsDialog.js";
import { ReadingSettings } from "./reader/ReadingSettings.js";
import { StoryCredit } from "./reader/StoryCredit.js";
import { WordGrammar } from "./reader/WordGrammar.js";
import { prefsStyle, useReaderPrefs } from "./reader/readerPrefs.js";
import "./reader/reader.css";
import { SentencePanel, SimplifyPage } from "./ReaderAI.js";
import { useAIReady } from "./StoryForm.js";
import { writeLastText } from "../lastText.js";
import { useWordActions } from "./useWordActions.js";
import { TextComplete } from "./TextComplete.js";
import { errorText } from "../services/errors.js";
import { usePageHeader, useShell } from "../shell/ShellContext.js";
import { liftAboveSheet, revealAboveSheet } from "../shell/revealAboveSheet.js";
import { useReaderAudio } from "../audio/ReaderAudio.js";
import { readLocal, writeLocal } from "../storage/local.js";
import { ReaderLeave, rememberReader, takeReaderReturn } from "./reader/readerReturn.js";
import {
  CardExtra,
  CardForms,
  CardMeaning,
  CardPos,
  CardRelated,
  CardSenses,
  useWordEntry,
} from "./reader/WordEntry.js";
import { DictionaryMissing } from "./reader/DictionaryMissing.js";
import { SentenceTab } from "./reader/SentenceTab.js";
import { contextGloss } from "../services/contextGloss.js";
import { onFullScreenLeft, setFullScreen } from "../platform/fullScreen.js";
import { useBackClose } from "../shell/backStack.js";

/**
 * Below this share of known words (%) the first page says the text is hard for the learner
 * (a Wikipedia page for an A1 learner), with Gloss mode or a story at their level.
 */
/** Words tapped on a page before its end offers to practise them. */
const PRACTISE_FROM = 2;
const HARD_TEXT = 80;
const HARD_SEEN = "vuurtoren-hard-seen:";
/** The reader's own speed, words a minute (book mode's time left), per device. */
const WPM_KEY = "vuurtoren-reading-wpm";
/** How long the place waits before it is saved, so quick turns make one event. */
const PLACE_DELAY = 1500;

/** Words that count as reading on a page (not punctuation or ignored tokens). */
const isWord = (t: { label: string }) => t.label !== "nonword" && t.label !== "ignored";

const HELP_LABEL: Record<HelpLevel, string> = {
  off: "Off",
  new: "New words",
  shaky: "New + shaky words",
  most: "Most words",
};
/** Gloss mode translates at least this many words on a page (unless the dial is off). */
const GLOSS_MIN = 2;
const MODES = [
  { value: "read", label: "Read" },
  { value: "cloze", label: "Cloze" },
  { value: "gloss", label: "Gloss" },
  { value: "side", label: "Side by side", short: "Side" },
] as const;

/** Elements whose own keyboard handling the reader's global shortcuts must not steal. */
const WIDGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "[data-tok]",
  "[role=dialog]",
  "[role=slider]",
  "[role=tab]",
  "[role=listbox]",
  "[role=option]",
  "[role=combobox]",
].join(",");
/** Overlays that own Esc (closing them must not also clear the selection). */
const OVERLAY_SELECTOR = "[role=dialog],[role=listbox],[role=option],[role=combobox],[role=menu]";

/**
 * Where a margin mark's popover goes: under the line of the last marked word, from the reading
 * column's left edge, so the underlined words stay visible above it.
 */
function belowHits(tokens: readonly number[]): DOMRect {
  const reader = document.querySelector(".k-reader")?.getBoundingClientRect();
  let best: DOMRect | null = null;
  for (const i of tokens) {
    const r = document.querySelector(`.k-reader [data-i="${i}"]`)?.getBoundingClientRect();
    if (r && (!best || r.bottom > best.bottom)) best = r;
  }
  if (!best || !reader) return reader ?? new DOMRect();
  return new DOMRect(reader.left, best.top, 0, best.height);
}

/**
 * Route component. Keying the page on the text id makes TanStack's reuse of the mounted
 * component (only `$textId` changed) start from a clean slate: segment, selection, answers
 * and counters of the previous text never carry over.
 */
export function ReaderRoute() {
  const { textId } = useParams({ from: "/read/$textId" });
  return <ReaderPage key={textId} textId={textId} />;
}

/**
 * Reader page: one segment at a time. Its controls live in the shell's top bar (one slim reader
 * bar: title, "82% known", Read | Cloze | Gloss | Side by side, Aa, …); the word inspector
 * slides in from the right when a word is chosen.
 */
export function ReaderPage({ textId }: { textId: string }) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const {
    mode,
    setMode,
    toolbarEl,
    inspectorEl,
    inspectorOpen,
    setInspectorAvailable,
    setInspectorOpen,
  } = useShell();
  const aiReady = useAIReady();

  const reading = useQuery({
    queryKey: ["reading", textId],
    queryFn: () => services.getReading(textId),
  });

  // Back from a grammar topic this reader opened: the same page, the same word (RD5).
  const [back] = useState(() => takeReaderReturn(textId));
  const [segment, setSegment] = useState<number | null>(back?.segment ?? null);
  const [selected, setSelected] = useState<number | null>(back?.selected ?? null);
  /**
   * Words opened from the card (its base verb, a family word): the card shows the last one,
   * "← back" and Esc / Android Back go back one (notes/wc2-word-card.md). Cleared when another
   * word of the text is tapped or the card closes.
   */
  const card = useWordCard(back?.card);
  const { stack, openWord, backWord, close: closeCard } = card;
  /** The restored word's sheet has not opened yet: closing logic must not clear it. */
  const restoring = useRef(back?.selected != null);
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
  /** Credit per answered cloze token: 1 unaided, 0.5 with the letter hint, 0 wrong or revealed. */
  const [credits, setCredits] = useState<ReadonlyMap<number, number>>(new Map());
  const lookups = useRef(0);
  /** The words tapped on each page, for "Practise these words" at its end (algorithms.md 4.7). */
  const [pageTaps, setPageTaps] = useState<Map<number, string[]>>(new Map());
  /** Segments finished in this visit; going back and forward again must not re-submit them. */
  const finished = useRef(new Set<number>());
  const [finishing, setFinishing] = useState(false);
  /** The last page was finished: show the calm completion panel with the next steps. */
  const [complete, setComplete] = useState(false);
  /** The "this text is hard for you" note was closed for this text. */
  const [hardSeen, setHardSeen] = useState(() => readLocal(`${HARD_SEEN}${textId}`) === "1");
  /** Bumped when the plan is deliberately recomputed (new-word budget changed). */
  const [epoch, setEpoch] = useState(0);
  /** Grammar: the focus topic, the open margin mark and the focus hit jumped to. */
  const [focusTopic, setFocusTopic] = useState<GrammarTopic | null>(() =>
    back?.focusTopic ? (grammarTopic(back.focusTopic) ?? null) : null,
  );
  const [openMark, setOpenMark] = useState<{ sent: number; el: HTMLElement } | null>(null);
  const [hitIndex, setHitIndex] = useState<number | null>(null);

  const data = reading.data;
  const plans = data?.plans;
  // Wait for a settled (not refetching) result before starting, so a stale cached plan or
  // resume point is never used.
  const settled = data != null && !reading.isFetching;
  // Resume at the saved place (book mode keeps it to the word), else the next segment to
  // read, clamped to the available segments.
  const resume = Math.min(
    data?.text.place?.segment ?? data?.text.lastSegment ?? 0,
    Math.max(0, (plans?.length ?? 1) - 1),
  );
  if (segment === null && settled) setSegment(resume);
  /** Book mode opens on this word once: back from grammar, or the saved place. */
  const [startPlace, setStartPlace] = useState<{ segment: number; char: number } | null>();
  if (startPlace === undefined && settled && data) {
    const sel = back?.selected != null ? data.tokens[back.selected] : undefined;
    setStartPlace(
      sel && back
        ? { segment: back.segment, char: sel.start }
        : data.text.place?.segment === resume
          ? data.text.place
          : null,
    );
  }
  const current = segment ?? resume;
  /** Save where we are before a grammar link leaves the reader (Back returns here, RD5). */
  const leaveFor = (topic: string) =>
    rememberReader({
      textId,
      segment: current,
      selected,
      focusTopic: focusTopic?.id ?? null,
      topic,
      card: { stack },
    });

  // The plan of the current segment is frozen when the segment starts: answers are keyed by
  // token index, so word actions or a window-focus refetch must not move clozes or amber
  // words under the learner. It is refreshed on segment change or when `epoch` changes.
  const livePlan = plans?.[current];
  const [frozen, setFrozen] = useState<{
    segment: number;
    epoch: number;
    plan: SegmentPlan;
  } | null>(null);
  if (
    livePlan &&
    segment !== null &&
    (frozen === null || frozen.segment !== current || frozen.epoch !== epoch)
  ) {
    setFrozen({ segment: current, epoch, plan: livePlan });
  }
  const plan =
    frozen && frozen.segment === current && frozen.epoch === epoch ? frozen.plan : undefined;

  usePageHeader(data?.text.title ?? "Reading", {
    reader: !complete,
    // The reader has no in-page heading, so the text title in the top bar is the page's h1.
    heading: true,
  });

  useEffect(() => {
    setInspectorAvailable(true);
    // Back from a grammar topic with a word selected: its sheet opens again, as it was.
    if (back?.selected != null) setInspectorOpen(true);
    return () => {
      setInspectorAvailable(false);
      setInspectorOpen(false);
    };
  }, [setInspectorAvailable, setInspectorOpen, back?.selected]);
  useEffect(() => writeLastText(textId), [textId]);

  /** When this page was opened, for the reading speed. */
  const pageStart = useRef(0);
  useEffect(() => {
    pageStart.current = Date.now();
  }, [current]);
  const resetSegmentState = useCallback(() => {
    setOpenMark(null);
    setHitIndex(null);
    setSelected(null);
    setRevealed(new Set());
    setCredits(new Map());
    lookups.current = 0;
  }, []);

  // Reading comforts (per device) and reading focus mode.
  const [prefs, setPrefs] = useReaderPrefs();
  const [readingFocus, setReadingFocus] = useState(false);
  // Book mode: pages turn instead of scrolling (BookPages.tsx).
  // Side by side is a study view that needs the whole width: it scrolls, as before.
  const book = prefs.pages === "turn" && mode !== "side";
  // Book mode is one flow: every segment's plan, the current one held as it was frozen.
  const flowPlans = useMemo(
    () => (plan ? (book && plans ? plans.map((p, i) => (i === current ? plan : p)) : [plan]) : []),
    [book, plans, plan, current],
  );
  const bookRef = useRef<BookHandle | null>(null);
  const [bookAt, setBookAt] = useState<BookScreen>({ screen: 0, screens: 1, anchor: null });
  /** The bars are hidden by a tap in the middle of the page. */
  const [bare, setBare] = useState(false);
  /** How far the text is lifted so the tapped word shows above the word sheet. */
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!book) return;
    const root = document.documentElement;
    root.dataset["book"] = "";
    if (bare) root.dataset["bookBare"] = "";
    return () => {
      delete root.dataset["book"];
      delete root.dataset["bookBare"];
    };
  }, [book, bare]);
  // The "…" menu (and its grammar view), the shortcuts list and Simplify this page.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>("menu");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [simplifyAt, setSimplifyAt] = useState<number | null>(null);
  useBackClose(simplifyAt !== null, () => setSimplifyAt(null));
  useEffect(() => {
    if (!readingFocus) return;
    document.documentElement.dataset["readingFocus"] = "";
    // The whole screen: no system bars, no window frame (fullScreen.ts).
    setFullScreen(true);
    const stop = onFullScreenLeft(() => setReadingFocus(false));
    return () => {
      stop();
      setFullScreen(false);
      delete document.documentElement.dataset["readingFocus"];
    };
  }, [readingFocus]);
  // Android's back gesture leaves focus mode first.
  useBackClose(readingFocus, () => setReadingFocus(false));

  // Esc steps back one layer: the selected word, then the grammar focus, then focus mode.
  // j/k/arrows from nowhere move focus into the text; Ctrl/Cmd +/− change the text size; F
  // toggles focus mode. Keys that belong to a control (slider, tabs, select, buttons, dialogs)
  // are left alone.
  const keyState = useRef({
    selected,
    focusTopic,
    readingFocus,
    size: prefs.size,
    stacked: stack.length,
  });
  useEffect(() => {
    keyState.current = {
      selected,
      focusTopic,
      readingFocus,
      size: prefs.size,
      stacked: stack.length,
    };
  });
  /** Turns the page (set below, once the page's navigation is known). */
  const stepRef = useRef<(dir: 1 | -1) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      const st = keyState.current;
      if (e.key === "Escape") {
        if (t?.closest(OVERLAY_SELECTOR)) return;
        if (st.selected === null && st.focusTopic) {
          setFocusTopic(null);
          setHitIndex(null);
          return;
        }
        if (st.selected === null && st.readingFocus) {
          setReadingFocus(false);
          return;
        }
        // A word opened from the card: back one word first.
        if (st.stacked > 0) {
          backWord();
          return;
        }
        // Then the card closes.
        setInspectorOpen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ["+", "=", "-", "0"].includes(e.key)) {
        e.preventDefault();
        setPrefs({ size: e.key === "0" ? 2 : st.size + (e.key === "-" ? -1 : 1) });
        return;
      }
      const typing = t?.closest("input, textarea, select, [contenteditable=true]");
      if (
        (e.key === "f" || e.key === "F") &&
        !typing &&
        !t?.closest(OVERLAY_SELECTOR) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setReadingFocus((v) => !v);
        return;
      }
      if (e.key === "?" && !typing && !t?.closest(OVERLAY_SELECTOR)) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (t?.closest(WIDGET_SELECTOR) || e.metaKey || e.ctrlKey || e.altKey) return;
      // ← → from outside the text turn the page; inside it they move word by word.
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        stepRef.current(e.key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (e.key === "j" || e.key === "k") {
        const el = document.querySelector<HTMLElement>('[data-tok][tabindex="0"]');
        if (el) {
          e.preventDefault();
          el.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setInspectorOpen, setPrefs, backWord]);

  // Closing the word panel (Esc or its close button) clears the selection and gives the focus
  // back to the word, so reading continues where it was.
  useEffect(() => {
    if (inspectorOpen) {
      restoring.current = false;
      return;
    }
    // Back from grammar: the sheet is about to open again for the restored word.
    if (restoring.current) return;
    const i = keyState.current.selected;
    if (i === null) return;
    setSelected(null);
    closeCard();
    document
      .querySelector<HTMLElement>(`.k-reader [data-i="${i}"]`)
      ?.focus({ preventScroll: true });
  }, [inspectorOpen, closeCard]);

  // The query data always belongs to the current key; keepPreviousData only avoids a flash, so
  // placeholder data (the previously selected word) is treated as "still loading".
  const inspect = useQuery({
    queryKey: ["inspect", textId, selected],
    queryFn: () => services.inspect(textId, selected as number),
    enabled: selected !== null,
    placeholderData: keepPreviousData,
  });
  const entry: InspectorEntry | null =
    selected !== null && !inspect.isPlaceholderData ? (inspect.data ?? null) : null;
  const opened = stack.at(-1) ?? null;
  const openedEntry = useQuery({
    queryKey: ["inspect-word", opened],
    queryFn: () => services.inspectWord(opened as string),
    enabled: opened !== null,
  });
  /** What the card shows: the word opened from the card, else the text's word. */
  const shown: InspectorEntry | null = opened ? (openedEntry.data ?? null) : entry;
  /** The shown word's dictionary entry, for the card's parts (one request, shared). */
  const dict = useWordEntry(shown?.lemma, shown?.pos ?? "");
  /** What the page's form is ("doet … open · present, ze"), for the text's own word. */
  const formInfo = !opened && selected !== null && data ? formLine(data.tokens, selected) : null;

  // Reader settings: the help dial (which words get a translation) and the new-word budget.
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => services.getSettings() });
  const [helpDraft, setHelpDraft] = useState<number | null>(null);
  const help = helpDraft ?? settingsQ.data?.help ?? 0.25;
  const saveSettings = useMutation({
    mutationFn: (patch: Parameters<typeof services.saveSettings>[0]) =>
      services.saveSettings(patch),
    onSuccess: async (_r, patch) => {
      await qc.invalidateQueries({ queryKey: ["settings"] });
      if ("newWords" in patch) {
        // A new budget re-plans the text: refetch, then start the segment again from the
        // fresh plan (the old answers were keyed to the old blanks).
        await qc.invalidateQueries({ queryKey: ["reading", textId] });
        void qc.invalidateQueries({ queryKey: ["texts"], refetchType: "none" });
        resetSegmentState();
        setEpoch((n) => n + 1);
      }
    },
    onError: (e) => toast("Could not save the reading setting", errorText(e)),
    onSettled: () => setHelpDraft(null),
  });

  // Grammar: hits are detected once per text and stored. The reader shows them as quiet
  // margin marks, or all hits of one focus topic.
  // They are also loaded when a word is selected, as context for "Explain this sentence".
  const marksOn = settingsQ.data?.grammarMarks ?? true;
  const grammarQ = useQuery({
    queryKey: ["grammar", "text", textId],
    queryFn: () => services.textGrammar(textId),
    enabled: data != null,
    staleTime: Infinity,
    retry: 1,
  });
  const hits = useMemo(() => grammarQ.data ?? [], [grammarQ.data]);
  // The text's levels, apart (LV8): its words (frequency bands) and its grammar.
  const ranksQ = useQuery({
    queryKey: ["starter-ranks"],
    queryFn: () => starterRanks(),
    staleTime: Infinity,
  });
  // A story has its levels from its own analysis, the same as on its cover.
  const storyQ = useQuery({
    queryKey: ["stories"],
    queryFn: () => services.storyShelf(),
    enabled: !!storySlugOf(data?.text.sourceRef),
  });
  const aboutText = useMemo(() => {
    if (!data) return null;
    const slug = storySlugOf(data.text.sourceRef);
    const story = slug ? storyQ.data?.find((c) => c.slug === slug) : undefined;
    const words = story
      ? story.wordsLevel
      : ranksQ.data
        ? roughTextLevel(data.tokens, ranksQ.data)
        : null;
    const levels = levelsLine(words, story ? story.grammarLevel : grammarLevel(hits));
    const count = `${data.text.wordCount.toLocaleString("en")} words`;
    return levels ? `${levels} · ${count}` : count;
  }, [data, ranksQ.data, hits, storyQ.data]);
  const learnerQ = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const [recent, setRecent] = useState(readRecentTopics);
  const markContext = useMemo(
    () => ({
      level: levelFromVocabulary(learnerQ.data?.vocabEstimate),
      recentTopics: new Set(recent),
    }),
    [learnerQ.data?.vocabEstimate, recent],
  );
  const selectedSent = selected !== null ? data?.tokens[selected]?.sent : undefined;
  const sentenceGrammar = useMemo(
    () =>
      selectedSent === undefined
        ? []
        : notesFor(hitsInSentence(hits, selectedSent)).map(({ topic, note }) => ({
            id: topic.id,
            title: topic.title,
            note,
          })),
    [hits, selectedSent],
  );

  // Translations by mode: Read shows none (clean text; click a word for its meaning), Cloze
  // only the blanks' meanings (the hint), Gloss whatever the dial selects.
  // Blanks: always in Cloze mode; in Gloss mode only when the user turns them on.
  const blanks = mode === "cloze" || (mode === "gloss" && (settingsQ.data?.glossClozes ?? false));
  const glossIdx = useMemo(() => {
    if (!plan) return [];
    // One flow (book mode): this segment and the next, so help is there when the reader is.
    const near = book && plans?.[current + 1] ? [plan, plans[current + 1]!] : [plan];
    const idx: number[] = [];
    for (const p of near) {
      // Detached particles ("op" in "bel ... op") share their verb's translation: show it once.
      if (mode === "gloss") {
        const dial = glossTargets(
          p.tokens.filter((t) => data?.tokens[t.i]?.particle_of == null),
          help,
          GLOSS_MIN,
        );
        idx.push(...(blanks ? [...new Set([...dial, ...p.clozes])] : dial));
      } else if (mode === "cloze" && prefs.clozeMeaning) idx.push(...p.clozes);
    }
    return [...new Set(idx)].sort((a, b) => a - b);
  }, [plan, plans, book, current, help, mode, data, blanks, prefs.clozeMeaning]);
  const glossQ = useQuery({
    queryKey: ["glosses", textId, current, glossIdx.join(",")],
    queryFn: () => services.glosses(textId, glossIdx),
    enabled: glossIdx.length > 0,
    placeholderData: keepPreviousData,
  });
  const { glosses, glossNotes } = useMemo(() => {
    const text: Record<number, string> = {};
    const notes: Record<number, string> = {};
    for (const i of glossIdx) {
      const g = glossQ.data?.[i];
      if (g) text[i] = g.text;
      if (g?.note) notes[i] = g.note;
    }
    return { glosses: text, glossNotes: notes };
  }, [glossIdx, glossQ.data]);

  // Sentences of the current page, and what the grammar marks show on it.
  const pageTokens = useMemo(() => new Set(plan?.tokens.map((t) => t.i) ?? []), [plan]);
  const pageSentences = useMemo(() => {
    const out = new Set<number>();
    for (const i of pageTokens) {
      const sent = data?.tokens[i]?.sent;
      if (sent !== undefined) out.add(sent);
    }
    return out;
  }, [pageTokens, data]);
  // Side by side: the page's sentences with their English and word pairs, and a word-order
  // note per sentence for the structure view.
  const side = mode === "side";

  const audio = useReaderAudio();
  const englishAI = prefs.englishAI && aiReady;
  const sentenceList = useMemo(() => [...pageSentences].sort((a, b) => a - b), [pageSentences]);
  const pairsQ = useQuery({
    queryKey: ["pairs", textId, current, englishAI, sentenceList.join(",")],
    queryFn: () => services.sentencePairs(textId, sentenceList, { ai: englishAI }),
    enabled: side && sentenceList.length > 0,
    staleTime: Infinity,
    // Without pairs because the language server was not ready: ask again until it answers;
    // slowly when every sentence already shows its English (a phone away from its computer).
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d?.some((p) => p.retry)) return false;
      return d.some((p) => p.retry && !p.english) ? 4000 : 30_000;
    },
  });
  const sentencePairs = useMemo(
    () => new Map((pairsQ.data ?? []).map((p) => [p.sent, p])),
    [pairsQ.data],
  );
  // The Sentence tab's word pairs (F3): the English lights up with the Dutch.
  const tabSent = entry && !opened ? data?.tokens[entry.tokenIndex]?.sent : undefined;
  const tabPairsQ = useQuery({
    queryKey: ["pairs", textId, "tab", tabSent, englishAI],
    queryFn: () => services.sentencePairs(textId, [tabSent as number], { ai: englishAI }),
    enabled: tabSent !== undefined && !sentencePairs.has(tabSent),
    staleTime: Infinity,
  });
  const tabPairs =
    tabSent === undefined ? undefined : (sentencePairs.get(tabSent) ?? tabPairsQ.data?.[0]);
  const orderNotes = useMemo(() => {
    const out = new Map<number, StructureNote>();
    if (!side || !data) return out;
    for (const sent of sentenceList) {
      const n = wordOrderNote(hits, sent, data.tokens);
      if (n) out.set(sent, { label: n.label, note: n.note });
    }
    return out;
  }, [side, data, hits, sentenceList]);

  const marks = useMemo(
    () =>
      marksOn && !focusTopic && !side
        ? marginMarks(hits, markContext, pageSentences)
        : new Map<number, MarginMark>(),
    [marksOn, focusTopic, hits, markContext, pageSentences, side],
  );
  const markLabels = useMemo(
    () => new Map([...marks].map(([sent, m]) => [sent, `Grammar: ${m.topic.title}`])),
    [marks],
  );
  const openMarkData = openMark ? marks.get(openMark.sent) : undefined;
  // Focus topic: its hits on this page, in text order (for the count and ‹ ›).
  const focusHits = useMemo(
    () =>
      focusTopic
        ? hitsForTopic(hits, focusTopic).filter((h) => h.tokens.some((i) => pageTokens.has(i)))
        : [],
    [focusTopic, hits, pageTokens],
  );
  const spotlights = useMemo(() => {
    const shown = focusTopic ? focusHits : (openMarkData?.hits ?? []);
    if (shown.length === 0) return undefined;
    const label = focusTopic?.title ?? openMarkData?.topic.title ?? "";
    const out = new Map<number, string>();
    for (const h of shown) for (const i of h.tokens) out.set(i, label);
    return out;
  }, [focusTopic, focusHits, openMarkData]);
  const currentHitTokens = useMemo(
    () => new Set(hitIndex !== null ? (focusHits[hitIndex]?.tokens ?? []) : []),
    [hitIndex, focusHits],
  );
  const pickerTopics = useMemo(() => topicsInText(hits), [hits]);
  const suggestedTopics = useMemo(
    () =>
      pickerTopics
        .map((t) => ({ ...t, score: topicPriority(t.topic, markContext) }))
        .filter((t) => t.score >= 1.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4),
    [pickerTopics, markContext],
  );
  const chooseFocus = (topic: GrammarTopic | null) => {
    setOpenMark(null);
    setHitIndex(null);
    setFocusTopic(topic);
    if (topic) {
      noteRecentTopic(topic.id);
      setRecent(readRecentTopics());
    }
  };
  /** "Focus on this" from the Sentence tab (WC4): the phone has no margin marks. */
  const focusTopicById = (id: string) => {
    const t = pickerTopics.find((p) => p.topic.id === id)?.topic;
    if (!t) return;
    chooseFocus(t);
    // On a phone the sheet covers the text: close it, so the marks show.
    if (window.matchMedia?.("(max-width: 699px)").matches) {
      setSelected(null);
      closeCard();
    }
  };
  const stepHit = (dir: 1 | -1) => {
    if (focusHits.length === 0) return;
    const n = focusHits.length;
    const next = hitIndex === null ? (dir === 1 ? 0 : n - 1) : (hitIndex + dir + n) % n;
    setHitIndex(next);
    const first = focusHits[next]?.tokens[0];
    const el = document.querySelector<HTMLElement>(`.k-reader [data-i="${first}"]`);
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  };

  // Book mode: while a word's sheet is open, lift the text so the word stays above it, as the
  // sheet slides up, fills with the entry, or is pulled up.
  useEffect(() => {
    if (!book || selected === null || !inspectorOpen) return;
    const sheet = document.querySelector(".inspector-panel");
    if (!sheet) return;
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const word = document.querySelector(`.book-flow .k-tok[data-i="${selected}"]`);
        const px = liftAboveSheet(word, document.querySelector(".book"));
        if (px !== null) setLift(px);
      });
    };
    run();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(run) : null;
    ro?.observe(sheet);
    sheet.addEventListener("transitionend", run);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      sheet.removeEventListener("transitionend", run);
    };
  }, [book, selected, inspectorOpen]);

  const onTokenClick = (i: number) => {
    setSelected(i);
    card.restart();
    setInspectorOpen(true);
    // On a phone the inspector is a bottom sheet: keep the word visible above it. A book page
    // can't scroll: its text lifts instead (the effect below) and stays on its screen.
    if (!book) revealAboveSheet(document.querySelector(`.k-tok[data-i="${i}"]`));
    const key = plan?.tokens.find((t) => t.i === i)?.key;
    const tok = data?.tokens[i];
    const t = tok && tok.particle_of !== null ? (data?.tokens[tok.particle_of] ?? tok) : tok;
    // A word that is another word here ("zijn hond" is not the verb "zijn"; a name; a
    // diminutive) counts as help on this page, but must not bring the lemma's card back.
    if (key && t && contextGloss(t).notTheCard) lookups.current += 1;
    else if (key) {
      lookups.current += 1;
      setPageTaps((m) => {
        const cur = m.get(current) ?? [];
        return cur.includes(key) ? m : new Map(m).set(current, [...cur, key]);
      });
      // Fire and forget: a failed lookup count is not worth interrupting the reading.
      services.recordLookup(textId, key).catch((e: unknown) => {
        console.warn("Could not record the lookup:", e);
      });
    }
  };

  const onClozeAnswer = (i: number, answer: string, hints: number) => {
    const tok = data?.tokens[i];
    if (!tok) return;
    // Credit by help used: unaided 1, first letter 0.5, half the word 0.25, revealed 0.
    const correct = answer !== "" && matchAnswer(answer, tok.text) !== "incorrect";
    const credit = !correct ? 0 : hints === 0 ? 1 : hints === 1 ? 0.5 : hints === 2 ? 0.25 : 0;
    setCredits((prev) => new Map(prev).set(i, credit));
    // The first answer per blank teaches the learner model; retries do not count.
    const key = plan?.tokens.find((t) => t.i === i)?.key;
    if (key && !credits.has(i)) {
      services.recordClozeAnswer(key, correct && hints < 3, hints > 0).catch((e: unknown) => {
        console.warn("Could not record the cloze answer:", e);
      });
    }
  };

  const actions = useWordActions(
    reading.data?.text.sourceKind === "ai" ? "ai" : "reading",
    () => qc.invalidateQueries({ queryKey: ["reading", textId] }),
    (key, change) => setFrozen((f) => (f ? { ...f, plan: relabelKey(f.plan, key, change) } : f)),
  );

  const isLast = plans ? current >= plans.length - 1 : true;
  const goTo = (n: number) => {
    resetSegmentState();
    setSegment(n);
  };

  /** Move on after a segment; after the last one the completion panel takes over. */
  const advance = async () => {
    if (isLast) {
      resetSegmentState();
      setInspectorOpen(false);
      setComplete(true);
      void qc.invalidateQueries({ queryKey: ["activity"] });
      document.getElementById("content")?.scrollTo?.({ top: 0 });
    } else {
      goTo(current + 1);
    }
  };

  /**
   * Record that segment `seg` was read (its stats, the reading speed, the resume point). A
   * segment already recorded, or before the resume point, is not sent again: it would read as an
   * "easy" signal with no stats.
   */
  const recordSegment = async (seg: number, p: SegmentPlan) => {
    if (!data || finished.current.has(seg) || seg < data.text.lastSegment) return;
    const words = p.tokens.filter(isWord).length;
    // In one flow (book mode) the answers of all pages are kept: count this page's own.
    const own = new Set(p.clozes);
    const mine = [...credits].filter(([i]) => own.has(i));
    // Blanks shown in Cloze mode count as answered even if left empty or revealed (0 credit).
    const tested = Math.max(mine.length, blanks ? p.clozes.length : 0);
    const credit = mine.reduce((a, [, c]) => a + c, 0);
    await services.finishSegment(textId, seg, {
      clozeAccuracy: tested > 0 ? credit / tested : null,
      lookupsPer100: words > 0 ? (lookups.current / words) * 100 : 0,
    });
    finished.current.add(seg);
    lookups.current = 0;
    // The reader's speed, for the time left: this page's words over the time it was open.
    const wpm = Number(readLocal(WPM_KEY)) || DEFAULT_WPM;
    writeLocal(WPM_KEY, String(nextWpm(wpm, words, Date.now() - pageStart.current)));
    pageStart.current = Date.now();
    // Keep the cached resume point current so reopening the text does not use a stale one.
    qc.setQueryData<ReadingView | null>(["reading", textId], (d) =>
      d ? { ...d, text: { ...d.text, lastSegment: Math.max(d.text.lastSegment, seg + 1) } } : d,
    );
    void qc.invalidateQueries({ queryKey: ["texts"], refetchType: "none" });
  };

  const finish = async () => {
    if (!plan || !data) return;
    setFinishing(true);
    try {
      await recordSegment(current, plan);
      await advance();
    } catch (e) {
      toast("Could not save your progress", errorText(e));
    } finally {
      setFinishing(false);
    }
  };

  /**
   * Book mode is one flow (M6): the whole text in the book, its segments one after another.
   * When the first word on the screen is in a later segment, the ones before are recorded as
   * read (as Next did); going back just moves the place. The text stays on screen throughout.
   */
  const passing = useRef(false);
  const passTo = async (n: number) => {
    if (!plans || passing.current || n === current) return;
    if (n < current) {
      setSegment(n);
      return;
    }
    passing.current = true;
    try {
      for (let k = current; k < n; k++) {
        const p = k === current ? plan : plans[k];
        if (p) await recordSegment(k, p);
      }
      setSegment(n);
    } catch (e) {
      toast("Could not save your progress", errorText(e));
    } finally {
      passing.current = false;
    }
  };
  /** The end of the flow: every segment read, then the text is done. */
  const finishFlow = async () => {
    if (!plans || !data || finishing) return;
    setFinishing(true);
    try {
      for (let k = current; k < plans.length; k++) {
        const p = k === current ? plan : plans[k];
        if (p) await recordSegment(k, p);
      }
      setSegment(plans.length - 1);
      resetSegmentState();
      setInspectorOpen(false);
      setComplete(true);
      void qc.invalidateQueries({ queryKey: ["activity"] });
    } catch (e) {
      toast("Could not save your progress", errorText(e));
    } finally {
      setFinishing(false);
    }
  };

  /** ‹ › and ← →: the previous page, or the next one (finishing this one; never the text). */
  const stepPage = (dir: 1 | -1) => {
    if (finishing || complete || !plan) return;
    if (dir === -1) {
      if (current > 0) goTo(current - 1);
    } else if (!isLast) void finish();
  };
  useEffect(() => {
    stepRef.current = (dir) => {
      if (book && bookRef.current) bookRef.current.turn(dir);
      else stepPage(dir);
    };
  });
  // Android: the volume keys turn pages while the reader is open, when asked for.
  const volumeOn = book && prefs.volumeKeys && !complete;
  useEffect(() => {
    if (!volumeOn) return;
    return takeVolumeKeys((dir) => stepRef.current(dir));
  }, [volumeOn]);

  // Book mode: the place to the word, saved a little after the turns stop (and on leaving).
  const placeSave = useRef<{ key: string; timer: number; run: (() => void) | null }>({
    key: "",
    timer: 0,
    run: null,
  });
  const charOfToken = useCallback((i: number) => data?.tokens[i]?.start, [data]);
  const onBookScreen = (s: BookScreen) => {
    if (s.screen !== bookAt.screen) setLift(0);
    setBookAt(s);
    const char = s.anchor !== null ? charOfToken(s.anchor) : undefined;
    // Which segment the screen starts in: the place moves with the reader.
    if (char !== undefined && plans) {
      const seg = plans.findIndex((p) => char >= p.segment.charStart && char < p.segment.charEnd);
      if (seg >= 0 && seg !== current) void passTo(seg);
    }
    if (char === undefined || !services.savePlace) return;
    const ps = placeSave.current;
    const key = `${current}:${char}`;
    // The first place of a visit is where it opened: nothing new to save.
    if (!ps.key) {
      ps.key = key;
      return;
    }
    if (key === ps.key) return;
    window.clearTimeout(ps.timer);
    const seg = current;
    ps.run = () => {
      ps.run = null;
      ps.key = key;
      services.savePlace?.(textId, seg, char).catch((e: unknown) => {
        console.warn("Could not save the place:", e);
      });
    };
    ps.timer = window.setTimeout(() => ps.run?.(), PLACE_DELAY);
  };
  useEffect(
    () => () => {
      const ps = placeSave.current;
      window.clearTimeout(ps.timer);
      ps.run?.();
    },
    [],
  );
  // Touch: swipe left or right turns the page, with a short slide of the new page.
  const [pageEl, setPageEl] = useState<HTMLDivElement | null>(null);
  const [turn, setTurn] = useState<"next" | "prev" | null>(null);
  useSwipePages(book ? null : pageEl, (dir) => {
    setTurn(dir === 1 ? "next" : "prev");
    stepPage(dir);
  });

  // A failed background refetch keeps the text on screen; only a failed first load is an error page.
  if (reading.isError && !data) {
    return (
      <div className="page">
        <EmptyState
          title="This text could not be opened"
          description={errorText(reading.error)}
          action={
            <div className="row">
              <Button variant="primary" onClick={() => void reading.refetch()}>
                Retry
              </Button>
              <Link to="/" className="k-btn">
                Back to Read
              </Link>
            </div>
          }
        />
      </div>
    );
  }
  if (reading.isPending || (data && !plan && plans && plans.length > 0)) {
    return (
      <div className="reader-page">
        <div style={{ maxWidth: "var(--measure)", margin: "0 auto" }} className="stack">
          <Skeleton style={{ height: 24 }} />
          <Skeleton style={{ height: 24 }} />
          <Skeleton style={{ height: 24, width: "70%" }} />
        </div>
      </div>
    );
  }
  if (!data || !plan) {
    return (
      <div className="page">
        <EmptyState
          title={data ? "There is nothing to read here yet" : "This text was not found"}
          description={data ? "The text has no readable words." : "It may have been deleted."}
          action={
            <Link to="/" className="k-btn k-btn--primary">
              Back to Read
            </Link>
          }
        />
      </div>
    );
  }

  const allAnswered = plan.clozes.every((i) => credits.has(i) || revealed.has(i));
  const closeHard = () => {
    writeLocal(`${HARD_SEEN}${textId}`, "1");
    setHardSeen(true);
  };
  // The whole text's coverage, the same number as on Read.
  const known = Math.round(textDifficulty(plans ?? [plan]).coverage * 100);
  // The highlighted (amber) words to learn, not every unknown word.
  const toLearn = plan.introduce.length;
  const knownTitle = `${known}% of this text known · ${toLearn} ${toLearn === 1 ? "word" : "words"} to learn on this page`;

  if (complete) {
    return (
      <div className="reader-page">
        <TextComplete
          textId={textId}
          title={data.text.title}
          wordCount={data.text.wordCount}
          onReadAgain={() => {
            setComplete(false);
            goTo(0);
          }}
        />
      </div>
    );
  }

  /** ‹ › and Next in book mode: the same move to another page, with one slide. */
  const turnPage = (dir: 1 | -1) => {
    if (book && bookRef.current && (dir < 0 ? current > 0 : !isLast)) {
      bookRef.current.leave(dir, () => stepPage(dir), "first");
    } else stepPage(dir);
  };
  const onNext = () => {
    if (book && bookRef.current && !isLast && !finishing) {
      bookRef.current.leave(1, () => void finish(), "first");
    } else void finish();
  };

  // Where the reader is in the text and the time left, from the first word on the screen and
  // the reader's own speed: one line, the only counter in book mode (M6).
  const timeLeft = (() => {
    if (!book || !data) return null;
    const anchor = bookAt.anchor ?? -1;
    const left = flowPlans.reduce(
      (n, p) => n + p.tokens.filter((t) => isWord(t) && t.i >= anchor).length,
      0,
    );
    const wpm = Number(readLocal(WPM_KEY)) || DEFAULT_WPM;
    const char = anchor >= 0 ? (data.tokens[anchor]?.start ?? 0) : 0;
    const pct = Math.round((char / Math.max(1, data.text.content.length)) * 100);
    return `${pct}% · ${minutesFor(left, wpm)} min left`;
  })();
  // The words to practise at the end: this page's taps, or in one flow all of the text's.
  const endTaps = book ? [...new Set([...pageTaps.values()].flat())] : pageTaps.get(current);
  const pageBody = (
    <>
      {current === 0 &&
      known < HARD_TEXT &&
      mode !== "gloss" &&
      !hardSeen &&
      !data.text.sourceRef?.startsWith("story:") ? (
        <div className="reader-hard" role="note">
          <span>You know about {known}% of the words in this text, so it will be hard.</span>
          <Button size="sm" variant="ghost" onClick={closeHard}>
            Not now
          </Button>
        </div>
      ) : null}
      {mode === "cloze" && plan.clozes.length === 0 ? (
        <p className="reader-cloze-empty" role="status">
          Cloze hides only words you know well, and this page has none yet.
        </p>
      ) : null}
      <div
        key={book ? "flow" : current}
        className="reader-turn"
        data-turn={turn ?? undefined}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) setTurn(null);
        }}
      >
        {side ? (
          <SideBySide
            key={`${current}-${epoch}`}
            text={data.text.content}
            tokens={data.tokens}
            plan={plan}
            pairs={sentencePairs}
            visibility={prefs.english}
            notes={orderNotes}
            selectedToken={selected}
            onTokenClick={onTokenClick}
            sentenceAction={audio.sentenceButton}
          />
        ) : (
          <Reader
            key={book ? `flow-${epoch}` : `${current}-${epoch}`}
            text={data.text.content}
            tokens={data.tokens}
            plans={flowPlans}
            selectedToken={selected}
            revealed={revealed}
            mode={mode}
            blanks={blanks}
            glosses={glosses}
            glossNotes={glossNotes}
            {...(spotlights ? { spotlights } : {})}
            spotlightCurrent={currentHitTokens}
            marks={markLabels}
            openMark={openMark?.sent ?? null}
            onMarkClick={(sent, el) =>
              setOpenMark((cur) => (cur?.sent === sent ? null : { sent, el }))
            }
            focusParagraphs={readingFocus}
            onTokenClick={onTokenClick}
            onClozeAnswer={onClozeAnswer}
          />
        )}
      </div>
      <StoryCredit sourceRef={data.text.sourceRef} />
      {simplifyAt === current && !book ? (
        <SimplifyPage
          key={current}
          text={data.text.content.slice(plan.segment.charStart, plan.segment.charEnd)}
          onClose={() => setSimplifyAt(null)}
        />
      ) : null}
      {(endTaps?.length ?? 0) >= PRACTISE_FROM ? (
        <section className="page-end" aria-label="Practise this page's words">
          <div className="page-end-chips" lang="nl">
            {pageTaps
              .get(current)!
              .slice(0, 6)
              .map((k) => (
                <span key={k} className="page-end-chip">
                  {k}
                </span>
              ))}
            {endTaps!.length > 6 ? (
              <span className="page-end-chip">+{endTaps!.length - 6}</span>
            ) : null}
          </div>
          <Link
            to="/practice"
            search={{ words: endTaps!.join(","), start: "1" }}
            className="k-btn k-btn--secondary"
          >
            Practise these {endTaps!.length} words
          </Link>
        </section>
      ) : null}
    </>
  );

  return (
    <ReaderLeave.Provider value={leaveFor}>
      <div
        ref={setPageEl}
        className="reader-page"
        style={prefsStyle(prefs)}
        {...(prefs.theme !== "app" ? { "data-reading-theme": prefs.theme } : {})}
        {...(readingFocus ? { "data-focus": "" } : {})}
        {...(book ? { "data-book": "" } : {})}
      >
        {toolbarEl
          ? createPortal(
              <>
                <span className="rbar-known" title={knownTitle}>
                  {known}% known
                </span>
                {focusTopic ? (
                  <FocusChip
                    topic={focusTopic}
                    count={focusHits.length}
                    current={hitIndex}
                    onStep={stepHit}
                    onClear={() => chooseFocus(null)}
                    onChange={() => {
                      setMenuView("grammar");
                      setMenuOpen(true);
                    }}
                  />
                ) : null}
                <span className="rbar-spacer" />
                <span className="rbar-modes">
                  <Tabs
                    aria-label="Reading mode"
                    items={MODES}
                    value={mode}
                    onValueChange={(v) => setMode(v as ReaderMode)}
                  />
                </span>
                <ModeMenu modes={MODES} value={mode} onChange={(v) => setMode(v as ReaderMode)} />
                <span className="rbar-tools">
                  <ReadingSettings
                    prefs={prefs}
                    onChange={setPrefs}
                    settings={{
                      mode,
                      ...(mode === "gloss"
                        ? {
                            help: {
                              value: Math.round(help * 100),
                              label: HELP_LABEL[helpLevel(help)],
                              onChange: (v: number) => setHelpDraft(v / 100),
                              onCommit: (v: number) => saveSettings.mutate({ help: v / 100 }),
                            },
                          }
                        : {}),
                      ...(mode === "gloss" && plan.clozes.length > 0
                        ? {
                            blanks: {
                              on: blanks,
                              onToggle: () => saveSettings.mutate({ glossClozes: !blanks }),
                            },
                          }
                        : {}),
                      newWords: {
                        value: String(settingsQ.data?.newWords ?? "auto"),
                        onChange: (v: string) =>
                          saveSettings.mutate({ newWords: v === "auto" ? "auto" : Number(v) }),
                      },
                      marks: {
                        on: marksOn,
                        onToggle: () => saveSettings.mutate({ grammarMarks: !marksOn }),
                      },
                      aiReady,
                    }}
                  />
                  <ReaderMenu
                    open={menuOpen}
                    onOpenChange={setMenuOpen}
                    view={menuView}
                    onViewChange={setMenuView}
                    textId={textId}
                    summary={knownTitle}
                    about={aboutText}
                    grammar={{
                      value: focusTopic,
                      topics: pickerTopics,
                      suggested: suggestedTopics,
                      onChange: chooseFocus,
                      unavailable: grammarQ.isError,
                    }}
                    readingFocus={readingFocus}
                    onFocusMode={() => setReadingFocus((v) => !v)}
                    onShowAnswers={
                      blanks && plan.clozes.length > 0 && !allAnswered
                        ? () => setRevealed(new Set(plan.clozes))
                        : undefined
                    }
                    onSimplify={aiReady ? () => setSimplifyAt(current) : undefined}
                    onEditDetails={() => setDetailsOpen(true)}
                    onShortcuts={() => setShortcutsOpen(true)}
                  />
                </span>
              </>,
              toolbarEl,
            )
          : null}
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <TextDetailsDialog
          text={detailsOpen ? data.text : null}
          onClose={() => setDetailsOpen(false)}
        />
        {readingFocus ? (
          <button
            type="button"
            className="reader-focus-exit"
            onClick={() => setReadingFocus(false)}
          >
            Leave focus mode <kbd>Esc</kbd>
          </button>
        ) : null}
        {book ? (
          <BookPages
            pageKey={`flow-${epoch}`}
            layoutKey={[
              prefs.size,
              prefs.leading,
              prefs.font,
              prefs.margins,
              prefs.spread,
              prefs.justify,
              prefs.english,
            ].join("-")}
            prefs={prefs}
            lang={data.text.lang}
            start={
              // Open where the reader was: the saved word, else the start of the resume segment.
              { pageKey: `flow-${epoch}`, char: startPlace?.char ?? plan.segment.charStart }
            }
            charOf={charOfToken}
            // One flow: only the end of the text leads on (to the finish).
            canLeave={(dir) => dir > 0 && !finishing && !complete}
            onLeave={() => void finishFlow()}
            onScreen={onBookScreen}
            onMiddle={() => setBare((v) => !v)}
            lift={inspectorOpen ? lift : 0}
            handle={bookRef}
          >
            {pageBody}
          </BookPages>
        ) : (
          pageBody
        )}
        {/* In book mode the easier version opens over the page, not in its flow: in the flow
            it made the page longer and the screens re-measure (M6). */}
        {book && simplifyAt === current ? (
          <div className="simplify-over" role="dialog" aria-label="Simplify this page">
            <SimplifyPage
              key={current}
              text={data.text.content.slice(plan.segment.charStart, plan.segment.charEnd)}
              onClose={() => setSimplifyAt(null)}
            />
          </div>
        ) : null}
        <AnchoredPopover
          anchor={openMarkData ? (openMark?.el ?? null) : null}
          onClose={() => setOpenMark(null)}
          label={openMarkData ? `Grammar: ${openMarkData.topic.title}` : "Grammar"}
          measure={() => belowHits(openMarkData?.hits.flatMap((h) => h.tokens) ?? [])}
          side="bottom"
          className="gmark-pop"
        >
          {openMarkData ? (
            <MarkCard
              topic={openMarkData.topic}
              note={openMarkData.hits[0]?.note}
              onFocus={() => chooseFocus(openMarkData.topic)}
            />
          ) : null}
        </AnchoredPopover>
        {book ? (
          <div className="book-chrome">
            {/* One flow: the scrub bar runs over the whole text's screens; one quiet line. */}
            <BookScrub
              pages={bookAt.screens}
              current={bookAt.screen}
              onJump={(n) => bookRef.current?.go(n)}
              label={(n) => `${Math.round(((n + 1) / Math.max(1, bookAt.screens)) * 100)}%`}
            />
            {timeLeft ? (
              <p className="book-left" aria-live="polite">
                {timeLeft}
              </p>
            ) : null}
          </div>
        ) : (
          <nav className="reader-footer" aria-label="Pages">
            <div className="reader-pager">
              <button
                type="button"
                className="reader-pager-btn"
                aria-label="Previous page"
                title="Previous page (←)"
                disabled={current === 0 || finishing}
                onClick={() => turnPage(-1)}
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
              <span className="reader-pager-count">
                <span aria-hidden>
                  {current + 1} / {plans?.length}
                </span>
                <span className="k-sr">
                  Page {current + 1} of {plans?.length}
                </span>
              </span>
              <button
                type="button"
                className="reader-pager-btn"
                aria-label="Next page"
                title="Next page (→)"
                disabled={isLast || finishing}
                onClick={() => turnPage(1)}
              >
                <ChevronRight size={18} aria-hidden />
              </button>
            </div>
            {book && bookAt.screens > 1 ? (
              <span className="book-screens" aria-live="polite">
                Screen {bookAt.screen + 1} of {bookAt.screens}
              </span>
            ) : null}
            <Button variant="primary" disabled={finishing} onClick={onNext}>
              {isLast ? (
                "Finish"
              ) : (
                <>
                  Next
                  <ArrowRight size={16} aria-hidden />
                </>
              )}
            </Button>
          </nav>
        )}
        {inspectorEl
          ? createPortal(
              <>
                <WordInspector
                  entry={shown}
                  loading={
                    opened
                      ? !openedEntry.data && !openedEntry.isError
                      : selected !== null && !entry && !inspect.isError
                  }
                  error={
                    opened && openedEntry.isError
                      ? errorText(openedEntry.error)
                      : selected !== null && inspect.isError
                        ? errorText(inspect.error)
                        : null
                  }
                  onRetry={() => void (opened ? openedEntry.refetch() : inspect.refetch())}
                  headerAction={audio.wordButton(shown)}
                  form={formInfo}
                  card={
                    shown
                      ? {
                          forms: dict ? (
                            <CardForms entry={dict} surface={shown.surface} onSay={audio.say} />
                          ) : null,
                          note: (
                            <>
                              {dict ? <CardPos entry={dict} /> : null}
                              {formInfo?.said.includes("…") ? (
                                <p className="k-card-note" lang="nl">
                                  {formInfo.said} is one verb
                                </p>
                              ) : null}
                            </>
                          ),
                          // The meanings numbered as in a dictionary, all of them (one entry, WC12).
                          meaning: dict ? (
                            <CardSenses word={shown} entry={dict} onOpen={openWord} />
                          ) : (
                            <CardMeaning word={shown} />
                          ),
                          related: dict ? (
                            <CardRelated entry={dict} onOpen={openWord} withSame={false} full />
                          ) : null,
                          extra: <CardExtra entry={dict} zipf={shown.zipf} />,
                        }
                      : undefined
                  }
                  backTo={
                    opened
                      ? { label: stack.at(-2) ?? entry?.lemma ?? "", onBack: backWord }
                      : undefined
                  }
                  {...actions.props(shown)}
                  wordExtra={
                    shown && entry ? (
                      <>
                        <DictionaryMissing />
                        {opened ? null : (
                          <WordGrammar
                            tokens={data.tokens}
                            index={entry.tokenIndex}
                            hits={hits}
                            article={entry.article}
                            onFocus={chooseFocus}
                          />
                        )}
                      </>
                    ) : null
                  }
                  sentencePanel={
                    entry && entry.sentence && tabSent !== undefined ? (
                      <SentenceTab
                        key={tabSent}
                        tokens={data.tokens}
                        sent={tabSent}
                        text={data.text.content}
                        sentence={entry.sentence}
                        translation={entry.sentenceTranslation}
                        pairs={tabPairs}
                        grammar={sentenceGrammar}
                        onFocusTopic={focusTopicById}
                      />
                    ) : (
                      <SentencePanel
                        sentence={entry?.sentence}
                        translation={entry?.sentenceTranslation}
                        grammar={sentenceGrammar}
                        onFocusTopic={focusTopicById}
                      />
                    )
                  }
                />
              </>,
              inspectorEl,
            )
          : null}
      </div>
    </ReaderLeave.Provider>
  );
}
