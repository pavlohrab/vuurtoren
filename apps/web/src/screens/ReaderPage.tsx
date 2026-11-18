import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Check, Maximize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type HelpLevel,
  type SegmentPlan,
  glossTargets,
  helpLevel,
  hitsAtToken,
  hitsInSentence,
} from "@app/core";
import type { GrammarTopic } from "@app/content";
import {
  AnchoredPopover,
  Button,
  EmptyState,
  Reader,
  Select,
  Skeleton,
  Slider,
  WordInspector,
  matchAnswer,
  useToast,
} from "@app/ui";
import { useServices } from "../services/context.js";
import type { InspectorEntry, ReadingView } from "../services/types.js";
import { GrammarNotes, notesFor } from "./GrammarNotes.js";
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
import { FocusCount, GrammarPicker, MarkCard } from "./reader/ReaderGrammar.js";
import { ReadingSettings } from "./reader/ReadingSettings.js";
import { prefsStyle, useReaderPrefs } from "./reader/readerPrefs.js";
import "./reader/reader.css";
import { ExplainSentence, SimplifyPage } from "./ReaderAI.js";
import { writeLastText } from "../lastText.js";
import { useWordActions } from "./useWordActions.js";
import { TextComplete } from "./TextComplete.js";
import { errorText } from "../services/errors.js";
import { usePageHeader, useShell } from "../shell/ShellContext.js";
import { revealAboveSheet } from "../shell/revealAboveSheet.js";

const HELP_LABEL: Record<HelpLevel, string> = {
  off: "Off",
  new: "New words",
  shaky: "New + shaky words",
  most: "Most words",
};
const NEW_WORD_OPTIONS = [
  { value: "auto", label: "Auto" },
  ...[0, 1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: String(n) })),
];

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

const errorMessage = (e: unknown): string => errorText(e);

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

/** Reader page: one segment at a time, with the word inspector in the shell's right panel. */
export function ReaderPage({ textId }: { textId: string }) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const { mode, inspectorEl, setInspectorAvailable, setInspectorOpen } = useShell();

  const reading = useQuery({
    queryKey: ["reading", textId],
    queryFn: () => services.getReading(textId),
  });

  const [segment, setSegment] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
  /** Credit per answered cloze token: 1 unaided, 0.5 with the letter hint, 0 wrong or revealed. */
  const [credits, setCredits] = useState<ReadonlyMap<number, number>>(new Map());
  const lookups = useRef(0);
  /** Segments finished in this visit; going back and forward again must not re-submit them. */
  const finished = useRef(new Set<number>());
  const [finishing, setFinishing] = useState(false);
  /** The last page was finished: show the calm completion panel with the next steps. */
  const [complete, setComplete] = useState(false);
  /** Bumped when the plan is deliberately recomputed (new-word budget changed). */
  const [epoch, setEpoch] = useState(0);
  /** Grammar: the focus topic, the open margin mark and the focus hit jumped to. */
  const [focusTopic, setFocusTopic] = useState<GrammarTopic | null>(null);
  const [openMark, setOpenMark] = useState<{ sent: number; el: HTMLElement } | null>(null);
  const [hitIndex, setHitIndex] = useState<number | null>(null);

  const data = reading.data;
  const plans = data?.plans;
  // Wait for a settled (not refetching) result before starting, so a stale cached plan or
  // resume point is never used.
  const settled = data != null && !reading.isFetching;
  // Resume at the next segment to read, clamped to the available segments.
  const resume = Math.min(data?.text.lastSegment ?? 0, Math.max(0, (plans?.length ?? 1) - 1));
  if (segment === null && settled) setSegment(resume);
  const current = segment ?? resume;

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
    coverage: complete ? null : (plan?.coverage ?? null),
    // The badge counts the highlighted (amber) words to learn, not every unknown word.
    newCount: complete ? null : (plan?.introduce.length ?? null),
    reader: !complete,
    // The reader has no in-page heading, so the text title in the top bar is the page's h1.
    heading: true,
  });

  useEffect(() => {
    setInspectorAvailable(true);
    return () => setInspectorAvailable(false);
  }, [setInspectorAvailable]);
  useEffect(() => writeLastText(textId), [textId]);

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
  useEffect(() => {
    if (!readingFocus) return;
    document.documentElement.dataset["readingFocus"] = "";
    return () => {
      delete document.documentElement.dataset["readingFocus"];
    };
  }, [readingFocus]);

  // Esc steps back one layer: the selected word, then the grammar focus, then focus mode.
  // j/k/arrows from nowhere move focus into the text; Ctrl/Cmd +/− change the text size; F
  // toggles focus mode. Keys that belong to a control (slider, tabs, select, buttons, dialogs)
  // are left alone.
  const keyState = useRef({ selected, focusTopic, readingFocus, size: prefs.size });
  useEffect(() => {
    keyState.current = { selected, focusTopic, readingFocus, size: prefs.size };
  });
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
        setSelected(null);
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
      if (t?.closest(WIDGET_SELECTOR) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (["j", "k", "ArrowRight", "ArrowLeft"].includes(e.key)) {
        const el = document.querySelector<HTMLElement>('[data-tok][tabindex="0"]');
        if (el) {
          e.preventDefault();
          el.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setInspectorOpen, setPrefs]);

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
    onError: (e) => toast("Could not save the reading setting", errorMessage(e)),
    onSettled: () => setHelpDraft(null),
  });

  // Grammar (M5): hits are detected once per text and stored. The reader shows them as quiet
  // margin marks (docs/research/09-reader-annotations.md), or all hits of one focus topic.
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
    // Detached particles ("op" in "bel ... op") share their verb's translation: show it once.
    if (mode === "gloss") {
      const dial = glossTargets(
        plan.tokens.filter((p) => data?.tokens[p.i]?.particle_of == null),
        help,
      );
      return blanks ? [...new Set([...dial, ...plan.clozes])].sort((a, b) => a - b) : dial;
    }
    if (mode === "cloze") return [...plan.clozes];
    return [];
  }, [plan, help, mode, data, blanks]);
  const glossQ = useQuery({
    queryKey: ["glosses", textId, current, glossIdx.join(",")],
    queryFn: () => services.glosses(textId, glossIdx),
    enabled: glossIdx.length > 0,
    placeholderData: keepPreviousData,
  });
  const glosses = useMemo(() => {
    const out: Record<number, string> = {};
    for (const i of glossIdx) {
      const g = glossQ.data?.[i];
      if (g) out[i] = g;
    }
    return out;
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
  const marks = useMemo(
    () =>
      marksOn && !focusTopic
        ? marginMarks(hits, markContext, pageSentences)
        : new Map<number, MarginMark>(),
    [marksOn, focusTopic, hits, markContext, pageSentences],
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

  const onTokenClick = (i: number) => {
    setSelected(i);
    setInspectorOpen(true);
    // On a phone the inspector is a bottom sheet: keep the word visible above it.
    revealAboveSheet(document.querySelector(`.k-tok[data-i="${i}"]`));
    const key = plan?.tokens.find((t) => t.i === i)?.key;
    if (key) {
      lookups.current += 1;
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
    // The first answer per blank teaches the learner model (ADR 0011); retries do not count.
    const key = plan?.tokens.find((t) => t.i === i)?.key;
    if (key && !credits.has(i)) {
      services.recordClozeAnswer(key, correct && hints < 3, hints > 0).catch((e: unknown) => {
        console.warn("Could not record the cloze answer:", e);
      });
    }
  };

  const actions = useWordActions(reading.data?.text.sourceKind === "ai" ? "ai" : "reading", () =>
    qc.invalidateQueries({ queryKey: ["reading", textId] }),
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

  const finish = async () => {
    if (!plan || !data) return;
    // A segment finished earlier (this visit, or before the resume point) is just navigated:
    // submitting it again would send a segment with no stats and read as an "easy" signal.
    if (finished.current.has(current) || current < data.text.lastSegment) {
      await advance();
      return;
    }
    setFinishing(true);
    try {
      const words = plan.tokens.filter(
        (t) => t.label !== "nonword" && t.label !== "ignored",
      ).length;
      // Blanks shown in Cloze mode count as answered even if left empty or revealed (0 credit).
      const tested = Math.max(credits.size, blanks ? plan.clozes.length : 0);
      const credit = [...credits.values()].reduce((a, b) => a + b, 0);
      await services.finishSegment(textId, current, {
        clozeAccuracy: tested > 0 ? credit / tested : null,
        lookupsPer100: words > 0 ? (lookups.current / words) * 100 : 0,
      });
      finished.current.add(current);
      // Keep the cached resume point current so reopening the text does not use a stale one.
      qc.setQueryData<ReadingView | null>(["reading", textId], (d) =>
        d
          ? { ...d, text: { ...d.text, lastSegment: Math.max(d.text.lastSegment, current + 1) } }
          : d,
      );
      void qc.invalidateQueries({ queryKey: ["texts"], refetchType: "none" });
      await advance();
    } catch (e) {
      toast("Could not save your progress", errorMessage(e));
    } finally {
      setFinishing(false);
    }
  };

  // A failed background refetch keeps the text on screen; only a failed first load is an error page.
  if (reading.isError && !data) {
    return (
      <div className="page">
        <EmptyState
          title="This text could not be opened"
          description={errorMessage(reading.error)}
          action={
            <div className="row">
              <Button variant="primary" onClick={() => void reading.refetch()}>
                Retry
              </Button>
              <Link to="/library" className="k-btn">
                Back to the library
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
            <Link to="/library" className="k-btn k-btn--primary">
              Back to the library
            </Link>
          }
        />
      </div>
    );
  }

  const allAnswered = plan.clozes.every((i) => credits.has(i) || revealed.has(i));

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

  return (
    <div
      className="reader-page"
      style={prefsStyle(prefs)}
      {...(prefs.theme !== "app" ? { "data-reading-theme": prefs.theme } : {})}
      {...(readingFocus ? { "data-focus": "" } : {})}
    >
      <div className="reader-tools" role="group" aria-label="Reading help">
        {mode === "gloss" ? (
          <div className="reader-tool">
            <span className="reader-tool-label">Translations</span>
            <div className="reader-tool-slider">
              <Slider
                aria-label="Translations"
                value={Math.round(help * 100)}
                onValueChange={(v) => setHelpDraft(v / 100)}
                onValueCommit={(v) => saveSettings.mutate({ help: v / 100 })}
              />
            </div>
            <span className="reader-tool-value">{HELP_LABEL[helpLevel(help)]}</span>
          </div>
        ) : null}
        {mode === "gloss" && plan.clozes.length > 0 ? (
          <div className="reader-tool">
            <button
              type="button"
              className="k-toggle k-toggle--sm"
              aria-pressed={blanks}
              onClick={() => saveSettings.mutate({ glossClozes: !blanks })}
            >
              {blanks ? <Check size={14} aria-hidden /> : null}
              {blanks ? "Blanks on" : "Blanks off"}
            </button>
          </div>
        ) : null}
        <div className="reader-tool reader-tool--grammar">
          <GrammarPicker
            topics={pickerTopics}
            suggested={suggestedTopics}
            value={focusTopic}
            onChange={chooseFocus}
            unavailable={grammarQ.isError}
          />
        </div>
        {focusTopic ? (
          <div className="reader-tool reader-tool--count">
            <FocusCount
              count={focusHits.length}
              current={hitIndex}
              onStep={stepHit}
              onClear={() => chooseFocus(null)}
            />
          </div>
        ) : null}

        <div className="reader-tool reader-tool--budget">
          <span className="reader-tool-label">Words to learn per page</span>
          <Select
            value={String(settingsQ.data?.newWords ?? "auto")}
            onValueChange={(v) =>
              saveSettings.mutate({ newWords: v === "auto" ? "auto" : Number(v) })
            }
            options={NEW_WORD_OPTIONS}
          />
        </div>
        <div className="reader-tool reader-tool--end">
          <ReadingSettings prefs={prefs} onChange={setPrefs} />
          <button
            type="button"
            className="reader-chip"
            aria-label="Focus mode (F)"
            title="Focus mode (F)"
            aria-pressed={readingFocus}
            onClick={() => setReadingFocus((v) => !v)}
          >
            <Maximize2 size={15} aria-hidden />
          </button>
        </div>
      </div>
      {readingFocus ? (
        <button type="button" className="reader-focus-exit" onClick={() => setReadingFocus(false)}>
          Leave focus mode <kbd>Esc</kbd>
        </button>
      ) : null}
      <Reader
        key={`${current}-${epoch}`}
        text={data.text.content}
        tokens={data.tokens}
        plans={[plan]}
        selectedToken={selected}
        revealed={revealed}
        mode={mode}
        blanks={blanks}
        glosses={glosses}
        {...(spotlights ? { spotlights } : {})}
        spotlightCurrent={currentHitTokens}
        marks={markLabels}
        openMark={openMark?.sent ?? null}
        onMarkClick={(sent, el) => setOpenMark((cur) => (cur?.sent === sent ? null : { sent, el }))}
        focusParagraphs={readingFocus}
        onTokenClick={onTokenClick}
        onClozeAnswer={onClozeAnswer}
      />
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
      <SimplifyPage
        key={current}
        text={data.text.content.slice(plan.segment.charStart, plan.segment.charEnd)}
      />
      <div className="reader-footer">
        <span className="k-hint">
          Segment {current + 1} of {plans?.length}
        </span>
        <div className="row">
          {blanks && plan.clozes.length > 0 && !allAnswered ? (
            <Button variant="ghost" onClick={() => setRevealed(new Set(plan.clozes))}>
              Show answers
            </Button>
          ) : null}
          <Link to="/read/$textId/words" params={{ textId }} className="k-btn k-btn--ghost">
            Words from this text
          </Link>
          {current > 0 ? <Button onClick={() => goTo(current - 1)}>Previous</Button> : null}
          <Button variant="primary" disabled={finishing} onClick={() => void finish()}>
            {isLast ? "Finish text" : "Next segment"}
          </Button>
        </div>
      </div>
      {inspectorEl
        ? createPortal(
            <>
              <WordInspector
                entry={entry}
                loading={selected !== null && !entry && !inspect.isError}
                error={selected !== null && inspect.isError ? errorMessage(inspect.error) : null}
                onRetry={() => void inspect.refetch()}
                {...actions.props(entry)}
              />
              {entry ? <GrammarNotes hits={hitsAtToken(hits, entry.tokenIndex)} /> : null}
              <ExplainSentence sentence={entry?.sentence} grammar={sentenceGrammar} />
            </>,
            inspectorEl,
          )
        : null}
    </div>
  );
}
