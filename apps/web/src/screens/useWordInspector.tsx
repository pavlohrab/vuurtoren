/**
 * The word inspector outside the reader and Words: Talk messages, Practice feedback and summary,
 * Home's word chips, a course unit's words. A screen calls `open` with a word as written (and
 * its sentence) or `openKey` with a lemma key, and renders `portal`; the inspector slides in
 * as in the reader, with the same actions.
 */
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { WordInspector } from "@app/ui";
import { useServices } from "../services/context.js";
import { errorText } from "../services/errors.js";
import type { AddSource } from "../services/profileTypes.js";
import { revealAboveSheet } from "../shell/revealAboveSheet.js";
import { useShell } from "../shell/ShellContext.js";
import { useWordActions } from "./useWordActions.js";

type Target = { key: string } | { form: string; sentence?: string | undefined };

export interface WordInspectorHandle {
  /** Open a word as written, with the sentence it stands in. */
  open: (form: string, sentence?: string, el?: Element | null) => void;
  /** Open a word by its lemma key. */
  openKey: (key: string, el?: Element | null) => void;
  /** The form or key shown now (to mark the chosen word), or null. */
  current: string | null;
  /** Render this once in the screen. */
  portal: ReactNode;
}

/** `source` picks the deck that words added from this screen go to. */
export function useWordInspector(source: AddSource): WordInspectorHandle {
  const services = useServices();
  const { inspectorEl, setInspectorAvailable, setInspectorOpen } = useShell();
  const [target, setTarget] = useState<Target | null>(null);
  const actions = useWordActions(source);

  const inspect = useQuery({
    // "inspect-word" first: the word actions refresh it after Add, Mark known…
    queryKey: [
      "inspect-word",
      "outside",
      target && "key" in target ? target.key : null,
      target && "form" in target ? target.form : null,
      target && "form" in target ? (target.sentence ?? null) : null,
    ],
    queryFn: () =>
      "key" in target!
        ? services.inspectWord(target.key)
        : services.inspectForm(target!.form, target!.sentence),
    enabled: target !== null,
  });

  useEffect(() => {
    setInspectorAvailable(target !== null);
    if (target) setInspectorOpen(true);
  }, [target, setInspectorAvailable, setInspectorOpen]);
  useEffect(() => () => setInspectorAvailable(false), [setInspectorAvailable]);

  const open = useCallback(
    (form: string, sentence?: string, el?: Element | null) => {
      setTarget({ form, sentence });
      setInspectorOpen(true);
      revealAboveSheet(el ?? null);
    },
    [setInspectorOpen],
  );
  const openKey = useCallback(
    (key: string, el?: Element | null) => {
      setTarget({ key });
      setInspectorOpen(true);
      revealAboveSheet(el ?? null);
    },
    [setInspectorOpen],
  );

  const entry = target ? (inspect.data ?? null) : null;
  const portal =
    inspectorEl && target
      ? createPortal(
          <WordInspector
            entry={entry}
            loading={!entry && !inspect.isError}
            error={inspect.isError ? errorText(inspect.error) : null}
            onRetry={() => void inspect.refetch()}
            emptyText="Choose a word to see its details."
            {...actions.props(entry)}
          />,
          inspectorEl,
        )
      : null;

  const current = target ? ("key" in target ? target.key : target.form) : null;
  return { open, openKey, current, portal };
}
