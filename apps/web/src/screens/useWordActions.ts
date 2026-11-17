/**
 * The word inspector's actions (Add to Anki with the deck picker, Study first in Anki, Mark
 * known, Ignore, Use Anki's state), shared by the Reader and Words so both behave the same.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WordState } from "@app/core";
import { type WordInspectorProps, useToast } from "@app/ui";
import { useServices } from "../services/context.js";
import { errorText } from "../services/errors.js";
import type { AddSource } from "../services/profileTypes.js";
import type { InspectorEntry } from "../services/types.js";
import { useDeckChoice } from "./useDeckChoice.js";

type ActionProps = Pick<
  WordInspectorProps,
  "busy" | "addDeck" | "onAddToAnki" | "onLearnNext" | "onMarkKnown" | "onReset" | "onSetState"
>;

/** Cached views that show word states; refreshed after any word action. */
const WORD_VIEWS = ["texts", "words", "learner", "textWords", "home", "practice"];

/**
 * Mutations for the inspector. `refresh` runs after a successful action (e.g. the reader
 * refetches its plan); the word lists and summaries are marked stale either way.
 */
export function useWordActions(source: AddSource, refresh?: () => Promise<unknown>) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const deckChoice = useDeckChoice(source);
  const deckOpts = deckChoice.chosen ? { deck: deckChoice.chosen } : undefined;

  const done = async () => {
    await Promise.all([
      refresh?.(),
      qc.invalidateQueries({ queryKey: ["inspect"] }),
      qc.invalidateQueries({ queryKey: ["inspect-word"] }),
    ]);
    for (const k of WORD_VIEWS) void qc.invalidateQueries({ queryKey: [k] });
  };

  // The mutations take the entry they act on as a variable, never "whatever is loaded now".
  const addToAnki = useMutation({
    mutationFn: (e: InspectorEntry) => services.addToAnki(e, deckOpts),
    onSuccess: async ({ deck }) => {
      toast(`Added to ${deck}`);
      await done();
    },
    onError: (e) => toast("Could not add to Anki", errorText(e)),
  });
  const learnNext = useMutation({
    mutationFn: (e: InspectorEntry) => services.learnNext(e),
    onSuccess: async ({ deck }) => {
      toast(deck ? `Moved to the front of ‘${deck}’` : "Moved to the front");
      await done();
    },
    onError: (e) => toast("Could not move the card", errorText(e)),
  });
  const markKnown = useMutation({
    mutationFn: (e: InspectorEntry) => services.markKnown(e, deckOpts),
    onSuccess: async ({ addedToDeck }) => {
      toast(addedToDeck ? `Added to ${addedToDeck} as known` : "Marked as known in Anki");
      await done();
    },
    onError: (e) => toast("Could not mark the word as known", errorText(e)),
  });
  const resetState = useMutation({
    mutationFn: (e: InspectorEntry) => services.resetWordState(e.key),
    onSuccess: async () => {
      toast("Using Anki’s state");
      await done();
    },
    onError: (e) => toast("Could not reset the word", errorText(e)),
  });
  const setState = useMutation({
    mutationFn: ({ e, state }: { e: InspectorEntry; state: WordState }) =>
      services.setWordState(e.key, state),
    onSuccess: async (_r, { state }) => {
      toast(state === "ignored" ? "Word ignored" : "Word updated");
      await done();
    },
    onError: (e) => toast("Could not update the word", errorText(e)),
  });

  const busy =
    addToAnki.isPending ||
    learnNext.isPending ||
    markKnown.isPending ||
    resetState.isPending ||
    setState.isPending;

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
        onSetState: (state: WordState) => entry && setState.mutate({ e: entry, state }),
      };
    },
  };
}
