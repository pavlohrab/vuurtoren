import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WordState } from "@app/core";
import { Button, EmptyState, Reader, Skeleton, WordInspector, useToast } from "@app/ui";
import { useServices } from "../services/context.js";
import { usePageHeader, useShell } from "../shell/ShellContext.js";

const normalize = (s: string) => s.trim().toLocaleLowerCase();

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
  const stats = useRef({ lookups: 0, answered: 0, correct: 0 });
  const [finishing, setFinishing] = useState(false);

  const data = reading.data;
  const plans = data?.plans;
  // Resume where the learner left off, clamped to the available segments.
  const current =
    segment ?? Math.min(data?.text.lastSegment ?? 0, Math.max(0, (plans?.length ?? 1) - 1));
  const plan = plans?.[current];

  usePageHeader(data?.text.title ?? "Reading", {
    coverage: plan?.coverage ?? null,
    newCount: plan?.newTypes.length ?? null,
    reader: true,
  });

  useEffect(() => {
    setInspectorAvailable(true);
    return () => setInspectorAvailable(false);
  }, [setInspectorAvailable]);

  const resetSegmentState = useCallback(() => {
    setSelected(null);
    setRevealed(new Set());
    stats.current = { lookups: 0, answered: 0, correct: 0 };
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

  // Gloss text for gloss/introduce tokens, so the reader can show it inline.
  const glossTokens = useMemo(
    () => (plan?.tokens ?? []).filter((t) => t.label === "gloss" || t.label === "introduce"),
    [plan],
  );
  const glossResults = useQueries({
    queries: glossTokens.map((t) => ({
      queryKey: ["inspect", textId, t.i],
      queryFn: () => services.inspect(textId, t.i),
    })),
  });
  const glosses: Record<number, string> = {};
  glossTokens.forEach((t, idx) => {
    const g = glossResults[idx]?.data?.glosses[0];
    if (g) glosses[t.i] = g;
  });

  const onTokenClick = (i: number) => {
    setSelected(i);
    setInspectorOpen(true);
    const key = plan?.tokens.find((t) => t.i === i)?.key;
    if (key) {
      stats.current.lookups += 1;
      void services.recordLookup(textId, key);
    }
  };

  const onClozeAnswer = (i: number, answer: string) => {
    const tok = data?.tokens[i];
    if (!tok) return;
    stats.current.answered += 1;
    if (normalize(answer) === normalize(tok.text)) stats.current.correct += 1;
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
      const { lookups, answered, correct } = stats.current;
      await services.finishSegment(textId, current, {
        clozeAccuracy: answered > 0 ? correct / answered : null,
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
