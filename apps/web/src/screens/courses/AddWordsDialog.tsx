import { plural } from "../../format.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AddToAnki, Button, Dialog, Lemma, Skeleton, useToast } from "@app/ui";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { useDeckChoice } from "../useDeckChoice.js";

/**
 * "Add words to Anki" for a unit or the whole course: a preview of the words that are not in
 * Anki yet (with de/het, a gloss and a sentence from the book), known words and existing notes
 * skipped, one deck picker (the shared AddToAnki control). Writes go through the shared
 * add-word command, one logged note per word.
 */
export function AddWordsDialog({
  courseId,
  scope,
  open,
  onOpenChange,
}: {
  courseId: string;
  scope: number | "all";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const deckChoice = useDeckChoice(
    "course",
    scope === "all" ? undefined : { courseId, unitN: scope },
  );
  const preview = useQuery({
    queryKey: ["add-words", courseId, scope],
    queryFn: () => services.addWordsPreview(courseId, scope),
    enabled: open,
  });
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const rows = preview.data?.rows ?? [];
  const fresh = rows.filter((r) => r.status === "new");
  const picked = fresh.filter((r) => !skipped.has(r.key));
  const known = rows.filter((r) => r.status === "known").length;
  const existing = rows.filter((r) => r.status === "in-anki").length;
  const unitDecks = [...new Set(Object.values(preview.data?.decks ?? {}))];
  const perUnit = scope === "all" && !deckChoice.chosen && unitDecks.length > 1;

  const add = useMutation({
    mutationFn: () =>
      services.addUnitWords(courseId, scope, {
        keys: picked.map((r) => r.key),
        ...(deckChoice.chosen ? { deck: deckChoice.chosen } : {}),
      }),
    onSuccess: async (r) => {
      toast(
        `${plural(r.added, "word")} added to ${perUnit ? "the units' decks" : r.deck}`,
        r.failed > 0 ? `${r.failed} could not be added.` : undefined,
      );
      await qc.invalidateQueries({ queryKey: ["unit", courseId] });
      await qc.invalidateQueries({ queryKey: ["course", courseId] });
      await qc.invalidateQueries({ queryKey: ["add-words", courseId] });
      onOpenChange(false);
    },
    onError: (e) => toast("Adding words did not work", errorText(e)),
  });

  const toggle = (key: string) =>
    setSkipped((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={scope === "all" ? "Add the course's words to Anki" : "Add this unit's words to Anki"}
      description="Words you know or already have in Anki are skipped. Each new note gets the sentence from your book."
    >
      {preview.isPending ? (
        <Skeleton style={{ height: 160, borderRadius: 8 }} />
      ) : preview.isError ? (
        <p className="error-text" role="alert">
          {errorText(preview.error)}
        </p>
      ) : (
        <>
          <p className="cs-meta" role="status">
            {fresh.length} new {fresh.length === 1 ? "word" : "words"}
            {existing ? ` · ${existing} already in Anki` : ""}
            {known ? ` · ${known} known` : ""}
          </p>
          {fresh.length === 0 ? (
            <p className="cs-note">Every word is in Anki already.</p>
          ) : (
            <ul className="cs-add-list" aria-label="Words to add">
              {fresh.map((r) => (
                <li key={r.key}>
                  <label className="cs-add-row">
                    <input
                      type="checkbox"
                      checked={!skipped.has(r.key)}
                      onChange={() => toggle(r.key)}
                      aria-label={`Add ${r.lemma}`}
                    />
                    <span className="cs-add-word">
                      <Lemma lemma={r.lemma} article={r.article} />
                      {r.gloss ? <span className="cs-gloss">{r.gloss}</span> : null}
                    </span>
                    {r.example ? (
                      <span className="cs-add-example" lang="nl">
                        {r.example}
                      </span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {perUnit ? (
            <p className="cs-hint">
              Each unit&rsquo;s words go to its own deck ({unitDecks[0]}, …). Pick a deck to put
              them all in one.
            </p>
          ) : null}
          <div className="cs-actions" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {deckChoice.addDeck ? (
              <AddToAnki
                {...deckChoice.addDeck}
                {...(!deckChoice.chosen && preview.data?.decks
                  ? {
                      deck: perUnit
                        ? "each unit's deck"
                        : (unitDecks[0] ?? deckChoice.addDeck.deck),
                    }
                  : {})}
                label={add.isPending ? "Adding to" : `Add ${picked.length} to`}
                disabled={add.isPending || picked.length === 0}
                onAdd={() => add.mutate()}
              />
            ) : (
              <Button
                variant="primary"
                disabled={add.isPending || picked.length === 0}
                onClick={() => add.mutate()}
              >
                {add.isPending ? "Adding…" : `Add ${picked.length} words`}
              </Button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
