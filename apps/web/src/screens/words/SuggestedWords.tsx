/**
 * Words → "Suggested by Claude": words Claude Code queued over MCP (suggest_words_for_anki).
 * Nothing reaches Anki until the learner clicks Add here; Dismiss drops a word.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { AddToAnki, Button, useToast } from "@app/ui";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { useDeckChoice } from "../useDeckChoice.js";

export function SuggestedWords() {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const deckChoice = useDeckChoice("mcp");
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["suggested-words"], queryFn: () => services.suggestedWords() });
  const refresh = () => {
    for (const k of ["suggested-words", "words", "inspect-word", "home", "learner"])
      void qc.invalidateQueries({ queryKey: [k] });
  };
  const add = useMutation({
    mutationFn: (key: string) =>
      services.addSuggestedToAnki(key, deckChoice.chosen ? { deck: deckChoice.chosen } : undefined),
    onSuccess: ({ deck }) => {
      toast(`Added to ${deck}`);
      refresh();
    },
    onError: (e) => toast("Could not add the word", errorText(e)),
  });
  const dismiss = useMutation({
    mutationFn: (key: string) => services.dismissSuggestion(key),
    onSuccess: refresh,
  });
  const list = q.data ?? [];
  if (list.length === 0) return null;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div>
        <button
          type="button"
          className="k-chip"
          aria-expanded={open}
          aria-controls="suggested-words"
          onClick={() => setOpen((o) => !o)}
        >
          <Sparkles size={14} aria-hidden /> Suggested by Claude ({list.length})
        </button>
      </div>
      {open ? (
        <ul
          id="suggested-words"
          className="stack"
          aria-label="Suggested by Claude"
          style={{ margin: 0, padding: 0, listStyle: "none", gap: 8 }}
        >
          {list.map((s) => (
            <li key={s.key} className="k-card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <div>
                  <strong>{s.word}</strong>
                  {s.gloss ? <span className="k-hint"> · {s.gloss}</span> : null}
                  {s.sentence ? (
                    <div style={{ fontFamily: "var(--font-reading)" }}>{s.sentence}</div>
                  ) : null}
                  {s.note ? <div className="k-hint">{s.note}</div> : null}
                </div>
                <div className="row">
                  {deckChoice.addDeck ? (
                    <AddToAnki
                      {...deckChoice.addDeck}
                      size="sm"
                      subject={s.word}
                      disabled={add.isPending}
                      onAdd={() => add.mutate(s.key)}
                    />
                  ) : (
                    <Button size="sm" disabled={add.isPending} onClick={() => add.mutate(s.key)}>
                      Add to Anki
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Dismiss ${s.word}`}
                    onClick={() => dismiss.mutate(s.key)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
