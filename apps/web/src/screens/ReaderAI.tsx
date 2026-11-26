import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { SentenceTurn } from "@app/ai";
import { Button, Input, Spinner } from "@app/ui";
import type { ExplainGrammar } from "../services/aiTypes.js";
import { Link } from "@tanstack/react-router";
import { useReaderLeave } from "./reader/readerReturn.js";

/** A grammar topic found in the sentence; with `id` it can be opened and focused (WC4). */
export interface SentenceGrammar extends ExplainGrammar {
  id?: string;
}
import { useServices } from "../services/context.js";
import { errorText } from "../services/errors.js";
import { Markdown } from "./Markdown.js";
import { useAIReady } from "./StoryForm.js";

const pct = (v: number | null) => (v === null ? "not scored" : `${(v * 100).toFixed(1)}%`);

/**
 * The word sheet's Sentence tab: the grammar found in the sentence, and "Explain this sentence"
 * as a short chat. The explanation and the answers are formatted (headings, bold, lists); the
 * learner can ask follow-up questions about the same sentence. Nothing is kept: a new sentence
 * starts clean.
 */
export function SentencePanel({
  sentence,
  translation,
  grammar,
  frame,
  text,
  onFocusTopic,
}: {
  sentence: string | null | undefined;
  /** The sentence's English, shown with it (F2: the tab has it too, not only the card). */
  translation?: string | null | undefined;
  /** Grammar detected in the sentence: listed, and sent along as context. */
  grammar?: SentenceGrammar[];
  /** "Focus on this": mark the topic all through the text (the margin mark does the same). */
  onFocusTopic?: (id: string) => void;
  /** The sentence part by part (the reader's SentenceFrameView), shown first. */
  frame?: ReactNode;
  /** The sentence and its English drawn by the caller (the Sentence tab links their words). */
  text?: ReactNode;
}) {
  if (!sentence) return <p className="k-hint">No sentence for this word.</p>;
  // Keyed by sentence so a new selection starts clean.
  return (
    <>
      {text ?? (
        <div className="sentence-panel-text">
          <p lang="nl">{sentence}</p>
          {translation ? <p lang="en">{translation}</p> : null}
        </div>
      )}
      {frame}
      <SentenceChat
        key={sentence}
        sentence={sentence}
        grammar={grammar ?? []}
        {...(onFocusTopic ? { onFocusTopic } : {})}
      />
    </>
  );
}

function SentenceChat({
  sentence,
  grammar,
  onFocusTopic,
}: {
  sentence: string;
  grammar: SentenceGrammar[];
  onFocusTopic?: (id: string) => void;
}) {
  const services = useServices();
  const leave = useReaderLeave();
  const ready = useAIReady();
  const [turns, setTurns] = useState<SentenceTurn[]>([]);
  const [question, setQuestion] = useState("");
  const explain = useMutation({
    mutationFn: () =>
      services.aiExplainSentence(
        sentence,
        grammar.map(({ title, note }) => ({ title, note })),
      ),
  });
  const ask = useMutation({
    mutationFn: (q: string) => services.aiAskAboutSentence(sentence, explain.data ?? "", turns, q),
    onSuccess: (answer, q) => setTurns((t) => [...t, { question: q, answer }]),
    onError: (_e, q) => setQuestion((d) => d || q),
  });
  return (
    <div className="sentence-panel">
      {grammar.length > 0 ? (
        <section>
          <div className="k-overline">Grammar in this sentence</div>
          <ul className="sentence-grammar">
            {grammar.map((g) => (
              <li key={g.title}>
                <strong>{g.title}</strong>: {g.note}
                {/* The phone has no margin marks: the topic opens from here too (WC4). */}
                {g.id ? (
                  <span className="sentence-grammar-actions">
                    {onFocusTopic ? (
                      <button type="button" className="k-link" onClick={() => onFocusTopic(g.id!)}>
                        Focus on this
                      </button>
                    ) : null}
                    <Link
                      to="/grammar/$topic"
                      params={{ topic: g.id }}
                      className="k-link"
                      onClick={() => leave?.(g.id!)}
                    >
                      Open the topic
                    </Link>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!ready ? (
        <p className="k-hint">Add your AI key to have sentences explained.</p>
      ) : !explain.data ? (
        <Button onClick={() => explain.mutate()} disabled={explain.isPending}>
          {explain.isPending ? <Spinner label="Explaining" /> : <Sparkles size={16} aria-hidden />}
          Explain this sentence
        </Button>
      ) : (
        <div className="sentence-chat" aria-live="polite">
          <div className="sentence-answer">
            <Markdown source={explain.data} />
          </div>
          {turns.map((t, i) => (
            <div key={i} className="sentence-turn">
              <p className="sentence-question">{t.question}</p>
              <div className="sentence-answer">
                <Markdown source={t.answer} />
              </div>
            </div>
          ))}
          {ask.isPending ? (
            <div className="sentence-turn">
              <p className="sentence-question">{ask.variables}</p>
              <Spinner label="Thinking" />
            </div>
          ) : null}
          <form
            className="sentence-ask"
            onSubmit={(e) => {
              e.preventDefault();
              const q = question.trim();
              if (!q || ask.isPending) return;
              setQuestion("");
              ask.mutate(q);
            }}
          >
            <Input
              aria-label="Ask about this sentence"
              placeholder="Ask about this sentence…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Button type="submit" disabled={!question.trim() || ask.isPending}>
              Ask
            </Button>
          </form>
        </div>
      )}
      {explain.isError || ask.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(explain.error ?? ask.error)}
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
