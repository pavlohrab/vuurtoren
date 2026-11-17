import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type HelpLevel, type WordState, glossTargets, helpLevel } from "@app/core";
import {
  Button,
  EmptyState,
  Reader,
  Select,
  Skeleton,
  Slider,
  WordInspector,
  useToast,
} from "@app/ui";
import { useServices } from "../services/context.js";
import { usePageHeader, useShell } from "../shell/ShellContext.js";

const normalize = (s: string) => s.trim().toLocaleLowerCase();

const HELP_LABEL: Record<HelpLevel, string> = {
  off: "Off",
  new: "New words",
  shaky: "New + shaky words",
  most: "Most words",
};
const NEW_WORD_OPTIONS = [
  { value: "auto", label: "Auto" },
  ...[0, 1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: `${n} per page` })),
];

/** Reader page: one segment at a time, with the word inspector in the shell's right panel. */
export function ReaderPage() {
  const { textId } = useParams({ from: "/read/$textId" });
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { mode, inspectorEl, setInspectorAvailable, setInspectorOpen } = useShell();

  const reading = useQuery({
    queryKey: ["reading", textId],
    queryFn: () => services.getReading(textId),
  });

  const [segment, setSegment] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
  // Per-segment outcome counters; refs because they never drive rendering.
  // `credit`: 1 per cloze recalled unaided, 0.5 with the letter hint, 0 if wrong or revealed.
  const stats = useRef({ lookups: 0, answered: 0, credit: 0 });
  const [finishing, setFinishing] = useState(false);

  const data = reading.data;
  const plans = data?.plans;
  // Resume where the learner left off, clamped to the available segments.
  const current =
    segment ?? Math.min(data?.text.lastSegment ?? 0, Math.max(0, (plans?.length ?? 1) - 1));
  const plan = plans?.[current];

  usePageHeader(data?.text.title ?? "Reading", {
    coverage: plan?.coverage ?? null,
    // The badge counts the highlighted (amber) words to learn, not every unknown word.
    newCount: plan?.introduce.length ?? null,
    reader: true,
  });

  useEffect(() => {
    setInspectorAvailable(true);
    return () => setInspectorAvailable(false);
  }, [setInspectorAvailable]);

  const resetSegmentState = useCallback(() => {
    setSelected(null);
    setRevealed(new Set());
    stats.current = { lookups: 0, answered: 0, credit: 0 };
  }, []);

  // Esc closes the inspector; j/k from nowhere moves focus into the text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setInspectorOpen(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = t?.closest("input, textarea, select, [data-tok], [role=dialog]");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
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
  }, [setInspectorOpen]);

  const inspect = useQuery({
    queryKey: ["inspect", textId, selected],
    queryFn: () => services.inspect(textId, selected as number),
    enabled: selected !== null,
    placeholderData: keepPreviousData,
  });

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
        await Promise.all(["reading", "texts"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      }
    },
  });
  // Persist the dial shortly after the user stops dragging.
  useEffect(() => {
    if (helpDraft === null) return;
    const id = setTimeout(() => saveSettings.mutate({ help: helpDraft }), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helpDraft]);

  // Translations by mode: Read shows none (clean text; click a word for its meaning), Cloze
  // only the blanks' meanings (the hint), Gloss whatever the dial selects.
  const glossIdx = useMemo(() => {
    if (!plan) return [];
    // Detached particles ("op" in "bel … op") share their verb's translation: show it once.
    if (mode === "gloss")
      return glossTargets(
        plan.tokens.filter((p) => data?.tokens[p.i]?.particle_of == null),
        help,
      );
    if (mode === "cloze") return [...plan.clozes];
    return [];
  }, [plan, help, mode, data]);
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

  const onTokenClick = (i: number) => {
    setSelected(i);
    setInspectorOpen(true);
    const key = plan?.tokens.find((t) => t.i === i)?.key;
    if (key) {
      stats.current.lookups += 1;
      void services.recordLookup(textId, key);
    }
  };

  const onClozeAnswer = (i: number, answer: string, hints: number) => {
    const tok = data?.tokens[i];
    if (!tok) return;
    stats.current.answered += 1;
    if (hints < 2 && normalize(answer) === normalize(tok.text)) {
      stats.current.credit += hints === 1 ? 0.5 : 1;
    }
  };

  const refreshWords = async () => {
    await Promise.all(
      ["reading", "inspect", "texts", "words", "learner"].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
  };

  const addToAnki = useMutation({
    mutationFn: () => {
      if (!inspect.data) throw new Error("Nothing selected");
      return services.addToAnki(inspect.data);
    },
    onSuccess: async () => {
      toast("Added to Anki");
      await refreshWords();
    },
    onError: () => toast("Could not add to Anki", "Check the connection in Settings."),
  });
  const setState = useMutation({
    mutationFn: (state: WordState) => {
      if (!inspect.data) throw new Error("Nothing selected");
      return services.setWordState(inspect.data.key, state);
    },
    onSuccess: async (_r, state) => {
      toast(state === "ignored" ? "Word ignored" : "Marked as known");
      await refreshWords();
    },
  });

  const isLast = plans ? current >= plans.length - 1 : true;
  const goTo = (n: number) => {
    resetSegmentState();
    setSegment(n);
  };

  const finish = async () => {
    if (!plan) return;
    setFinishing(true);
    try {
      const words = plan.tokens.filter(
        (t) => t.label !== "nonword" && t.label !== "ignored",
      ).length;
      const { lookups, answered, credit } = stats.current;
      await services.finishSegment(textId, current, {
        clozeAccuracy: answered > 0 ? credit / answered : null,
        lookupsPer100: words > 0 ? (lookups / words) * 100 : 0,
      });
      await qc.invalidateQueries({ queryKey: ["texts"] });
      if (isLast) {
        toast("Text finished", "Its new words are listed under Words.");
        await navigate({ to: "/library" });
      } else {
        goTo(current + 1);
      }
    } finally {
      setFinishing(false);
    }
  };

  if (reading.isPending) {
    return (
      <div className="reader-page">
        <div style={{ maxWidth: "66ch", margin: "0 auto" }} className="stack">
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
          title="This text was not found"
          description="It may have been deleted."
          action={
            <Link to="/library" className="k-btn k-btn--primary">
              Back to the library
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="reader-page">
      <div className="reader-tools" role="group" aria-label="Reading help">
        {mode === "gloss" ? (
          <div className="reader-tool">
            <span className="reader-tool-label">Translations</span>
            <div className="reader-tool-slider">
              <Slider
                aria-label="Translations"
                value={Math.round(help * 100)}
                onValueChange={(v) => setHelpDraft(v / 100)}
              />
            </div>
            <span className="reader-tool-value">{HELP_LABEL[helpLevel(help)]}</span>
          </div>
        ) : null}
        <div className="reader-tool">
          <span className="reader-tool-label">New words</span>
          <Select
            value={String(settingsQ.data?.newWords ?? "auto")}
            onValueChange={(v) =>
              saveSettings.mutate({ newWords: v === "auto" ? "auto" : Number(v) })
            }
            options={NEW_WORD_OPTIONS}
          />
        </div>
      </div>
      <Reader
        key={current}
        text={data.text.content}
        tokens={data.tokens}
        plans={[plan]}
        selectedToken={selected}
        revealed={revealed}
        mode={mode}
        glosses={glosses}
        onTokenClick={onTokenClick}
        onClozeAnswer={onClozeAnswer}
      />
      <div className="reader-footer">
        <span className="k-hint">
          Segment {current + 1} of {plans?.length}
        </span>
        <div className="row">
          {mode === "cloze" && plan.clozes.length > 0 ? (
            <Button variant="ghost" onClick={() => setRevealed(new Set(plan.clozes))}>
              Show answers
            </Button>
          ) : null}
          {current > 0 ? <Button onClick={() => goTo(current - 1)}>Previous</Button> : null}
          <Button variant="primary" disabled={finishing} onClick={() => void finish()}>
            {isLast ? "Finish text" : "Next segment"}
          </Button>
        </div>
      </div>
      {inspectorEl
        ? createPortal(
            <WordInspector
              entry={selected === null ? null : (inspect.data ?? null)}
              busy={addToAnki.isPending || setState.isPending}
              onAddToAnki={() => addToAnki.mutate()}
              onSetState={(s) => setState.mutate(s)}
            />,
            inspectorEl,
          )
        : null}
    </div>
  );
}
