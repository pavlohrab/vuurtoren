/**
 * The word inspector's actions (Add to Anki or to my words with the deck picker, Study first,
 * Mark known, Ignore, Use Anki's state), shared by every screen that opens the inspector.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { WordChange } from "@app/core";
import { type WordInspectorProps, deckName, useNativeMode, useToast } from "@app/ui";
import { useServices } from "../services/context.js";
import { errorText } from "../services/errors.js";
import type { AddSource } from "../services/profileTypes.js";
import type { InspectorEntry, KnownUndo } from "../services/types.js";
import { useDeckChoice } from "./useDeckChoice.js";

type ActionProps = Pick<
  WordInspectorProps,
  | "busy"
  | "addDeck"
  | "onAddToAnki"
  | "onLearnNext"
  | "onMarkKnown"
  | "onReset"
  | "onUndo"
  | "undoLabel"
>;

/** How long "✓ Added · Undo" (or "✓ Known · Undo") stays after the action. */
const UNDO_MS = 5000;

/** Cached views that show word states; refreshed after any word action. */
const WORD_VIEWS = ["texts", "words", "learner", "textWords", "home", "practice", "reading"];

/**
 * Mutations for the inspector. `refresh` runs after a successful action (e.g. the reader
 * refetches its plan); the word lists and summaries are marked stale either way. `changed`
 * hears the word's new state at once, so a screen can update every place the word shows.
 */
export function useWordActions(
  source: AddSource,
  refresh?: () => Promise<unknown>,
  changed?: (key: string, change: WordChange) => void,
) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const native = useNativeMode();
  const deckChoice = useDeckChoice(source);
  const deckOpts = deckChoice.chosen ? { deck: deckChoice.chosen } : undefined;

  const done = async () => {
    await Promise.all([
      refresh?.(),
      qc.invalidateQueries({ queryKey: ["inspect"] }),
      qc.invalidateQueries({ queryKey: ["inspect-word"] }),
    ]);
    // The reader's own `refresh` has just refetched its page: not a second time (A9).
    for (const k of WORD_VIEWS) {
      if (refresh && k === "reading") continue;
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };

  // The mutations take the entry they act on as a variable, never "whatever is loaded now".
  // The word just added to my words, for a few seconds: its card offers Undo (native only).
  const [justAdded, setJustAdded] = useState<{ key: string; noteId: number } | null>(null);
  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [justAdded]);
  // The word just marked known, for a few seconds: Undo puts its cards back (native only).
  const [justKnown, setJustKnown] = useState<{ key: string; undo: KnownUndo } | null>(null);
  useEffect(() => {
    if (!justKnown) return;
    const t = setTimeout(() => setJustKnown(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [justKnown]);
  const addToAnki = useMutation({
    mutationFn: (e: InspectorEntry) => services.addToAnki(e, deckOpts),
    onSuccess: async ({ deck, noteId }, e) => {
      changed?.(e.key, "learning");
      toast(native ? "Added to your words" : "Added to Anki", deckName(deck));
      if (native && services.removeWord) setJustAdded({ key: e.key, noteId });
      await done();
    },
    onError: (e) =>
      toast(native ? "Could not add the word" : "Could not add to Anki", errorText(e)),
  });
  const learnNext = useMutation({
    mutationFn: (e: InspectorEntry) => services.learnNext(e),
    onSuccess: async () => {
      toast("Moved to the front of the queue");
      await done();
    },
    onError: (e) => toast("Could not move the card", errorText(e)),
  });
  const markKnown = useMutation({
    mutationFn: (e: InspectorEntry) => services.markKnown(e, deckOpts),
    onSuccess: async ({ addedToDeck, undo }, e) => {
      changed?.(e.key, "known");
      if (undo && services.undoKnown) setJustKnown({ key: e.key, undo });
      // Undo on the toast too: a word list moves on to the next word, and the card with it.
      toast(
        "Marked as known",
        addedToDeck
          ? `${native ? "Added to your words" : "Added to Anki"}, ${deckName(addedToDeck)}`
          : undefined,
        {
          label: "Undo",
          onAct: () =>
            undo && services.undoKnown
              ? undoKnown.mutate({ key: e.key, undo })
              : resetState.mutate(e),
        },
      );
      await done();
    },
    onError: (e) => toast("Could not mark the word as known", errorText(e)),
  });
  const resetState = useMutation({
    mutationFn: (e: InspectorEntry) => services.resetWordState(e.key),
    onSuccess: async (_r, e) => {
      toast(
        e.state === "known"
          ? "Not marked as known any more"
          : e.state === "ignored"
            ? "Not ignored any more"
            : native
              ? "Using the card’s state"
              : "Using Anki’s state",
      );
      await done();
    },
    onError: (e) => toast("Could not reset the word", errorText(e)),
  });
  const undo = useMutation({
    mutationFn: (added: { key: string; noteId: number }) => services.removeWord!(added.noteId),
    onSuccess: async () => {
      setJustAdded(null);
      toast("Taken out of your words");
      await done();
    },
    onError: (e) => toast("Could not undo", errorText(e)),
  });
  const undoKnown = useMutation({
    mutationFn: (k: { key: string; undo: KnownUndo }) => services.undoKnown!(k.undo),
    onSuccess: async () => {
      setJustKnown(null);
      toast("Not marked as known any more");
      await done();
    },
    onError: (e) => toast("Could not undo", errorText(e)),
  });
  const busy =
    addToAnki.isPending ||
    learnNext.isPending ||
    markKnown.isPending ||
    resetState.isPending ||
    undo.isPending ||
    undoKnown.isPending;

  return {
    deckChoice,
    /** WordInspector props acting on `entry`. */
    props(entry: InspectorEntry | null): ActionProps {
      return {
        busy,
        addDeck: deckChoice.addDeck,
        onAddToAnki: () => entry && addToAnki.mutate(entry),
        onLearnNext: () => entry && learnNext.mutate(entry),
        onMarkKnown: () => entry && markKnown.mutate(entry),
        onReset: () => entry && resetState.mutate(entry),
        ...(entry && justKnown?.key === entry.key
          ? { onUndo: () => undoKnown.mutate(justKnown), undoLabel: "✓ Known" }
          : {
              onUndo:
                entry && justAdded?.key === entry.key ? () => undo.mutate(justAdded) : undefined,
            }),
      };
    },
  };
}
