/**
 * Where Add to Anki writes from one place in the app: the language profile's deck for `source`
 * (and course unit), or the deck the learner picked in the AddToAnki picker. A pick lasts for
 * the session, per source and unit.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AddDeckChoice } from "@app/ui";
import { useServices } from "../services/context.js";
import type { AddSource, CourseDeckContext } from "../services/profileTypes.js";

const picks = new Map<string, string>();

interface DeckChoice {
  /** The deck words go to now (undefined while loading). */
  deck: string | undefined;
  /** Explicit picker choice to pass to the add call (undefined = profile's rule). */
  chosen: string | undefined;
  /** Props for AddToAnki / WordInspector `addDeck` (undefined while loading). */
  addDeck: AddDeckChoice | undefined;
}

export function useDeckChoice(source: AddSource, course?: CourseDeckContext): DeckChoice {
  const services = useServices();
  const id = `${source}:${course?.courseId ?? ""}:${course?.unitN ?? ""}`;
  const [chosen, setChosen] = useState<string | undefined>(() => picks.get(id));
  const q = useQuery({
    queryKey: ["deckChoices", source, course?.courseId ?? null, course?.unitN ?? null],
    queryFn: () => services.deckChoices(source, course),
    staleTime: 60_000,
  });
  const deck = chosen ?? q.data?.deck;
  const onDeckChange = (d: string) => {
    picks.set(id, d);
    setChosen(d);
  };
  return {
    deck,
    chosen,
    addDeck: deck && q.data ? { deck, options: q.data.options, onDeckChange } : undefined,
  };
}
