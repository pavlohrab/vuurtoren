import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Button, Spinner } from "@app/ui";
import type { ExplainGrammar } from "../services/aiTypes.js";
import { useServices } from "../services/context.js";
import { errorText } from "../services/errors.js";
import { useAIReady } from "./StoryForm.js";

const pct = (v: number | null) => (v === null ? "not scored" : `${(v * 100).toFixed(1)}%`);

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
          {errorText(explain.error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Simplify this page" (started from the reader's "…" menu): a rewrite shown under the original,
 * re-scored. The text is untouched. It runs once when shown.
 */
export function SimplifyPage({ text, onClose }: { text: string; onClose: () => void }) {
  const services = useServices();
  const simplify = useMutation({ mutationFn: () => services.aiSimplify(text) });
  const started = useRef(false);
  const { mutate } = simplify;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate();
  }, [mutate]);
  return (
    <section className="stack reader-simplify" aria-label="Simplify this page">
      <div className="row">
        {simplify.isPending ? <Spinner label="Simplifying" /> : null}
        <span className="k-hint">
          {simplify.isPending ? "Simplifying this page…" : "Simplified page"}
        </span>
        <span style={{ flex: 1 }} />
        {simplify.isError ? (
          <Button variant="ghost" onClick={() => simplify.mutate()}>
            Try again
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Hide
        </Button>
      </div>
      {simplify.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(simplify.error)}
        </p>
      ) : null}
      {simplify.data ? (
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
              <h3 className="reader-ai-h">Original</h3>
              <p lang="nl" className="reader-ai-text">
                {text}
              </p>
            </div>
            <div>
              <h3 className="reader-ai-h">Simplified</h3>
              <p lang="nl" className="reader-ai-text">
                {simplify.data.simplified}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
