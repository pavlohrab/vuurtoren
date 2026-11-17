import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Spinner } from "@app/ui";
import type { ExplainGrammar } from "../services/aiTypes.js";
import { useServices } from "../services/context.js";

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "Try again.");
const pct = (v: number | null) => (v === null ? "not scored" : `${(v * 100).toFixed(1)}%`);

/** True once an AI provider is usable; the helpers below render nothing otherwise. */
function useAIReady(): boolean {
  const services = useServices();
  const q = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  return q.data?.configured === true;
}

/** "Explain this sentence" for the sentence of the selected word (shown under the inspector). */
export function ExplainSentence({
  sentence,
  grammar,
}: {
  sentence: string | null | undefined;
  /** Grammar detected in the sentence, sent along as context. */
  grammar?: ExplainGrammar[];
}) {
  const services = useServices();
  const ready = useAIReady();
  const explain = useMutation({
    mutationFn: (s: string) => services.aiExplainSentence(s, grammar),
  });
  if (!ready || !sentence) return null;
  return (
    // Keyed by sentence so a new selection starts clean.
    <div key={sentence} className="stack" style={{ paddingTop: 12 }}>
      <Button
        onClick={() => explain.mutate(sentence)}
        disabled={explain.isPending}
        aria-label="Explain this sentence"
      >
        {explain.isPending ? <Spinner label="Explaining" /> : null}
        Explain this sentence
      </Button>
      {explain.data ? (
        <p role="status" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {explain.data}
        </p>
      ) : null}
      {explain.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {message(explain.error)}
        </p>
      ) : null}
    </div>
  );
}

/** "Simplify this page": a rewrite shown beside the original, re-scored. The text is untouched. */
export function SimplifyPage({ text }: { text: string }) {
  const services = useServices();
  const ready = useAIReady();
  const [open, setOpen] = useState(false);
  const simplify = useMutation({ mutationFn: () => services.aiSimplify(text) });
  if (!ready) return null;
  return (
    <section className="stack" style={{ maxWidth: "66ch", margin: "16px auto 0" }}>
      <div className="row">
        <Button
          onClick={() => {
            setOpen(true);
            simplify.mutate();
          }}
          disabled={simplify.isPending}
        >
          {simplify.isPending ? <Spinner label="Simplifying" /> : null}
          Simplify this page
        </Button>
        {open ? (
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Hide
          </Button>
        ) : null}
      </div>
      {open && simplify.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {message(simplify.error)}
        </p>
      ) : null}
      {open && simplify.data ? (
        <div role="region" aria-label="Simplified page">
          <p className="k-hint" style={{ margin: "0 0 8px" }}>
            Words you know: {pct(simplify.data.before)} in the original, {pct(simplify.data.after)}{" "}
            in the simplified version. The original text is unchanged.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            <div>
              <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>Original</h3>
              <p lang="nl" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {text}
              </p>
            </div>
            <div>
              <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>Simplified</h3>
              <p lang="nl" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {simplify.data.simplified}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
