/**
 * Sound in the reader: a play button for the inspected word (the starter clip when the word
 * stands in its dictionary form, else the system voice says it as written) and, side by side,
 * one per sentence (the clip when it is a starter sentence, else the system voice).
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { clipId, wordClipText } from "@app/anki";
import type { InspectorEntry } from "@app/core";
import { loadStarterWords } from "../services/starterWords.js";
import { PlayButton, useSay } from "./useSay.js";

/** The starter sentences, to know which sentences have a clip. Loaded on first use. */
function useStarterSentences(enabled: boolean): ReadonlySet<string> | undefined {
  return useQuery({
    queryKey: ["starter", "sentences"],
    queryFn: async () =>
      new Set((await loadStarterWords()).flatMap((w) => (w.sentence ? [w.sentence] : []))),
    staleTime: Infinity,
    enabled,
  }).data;
}

export function useReaderAudio(sideBySide: boolean) {
  const { play, playing } = useSay();
  const starter = useStarterSentences(sideBySide);

  const wordButton = (entry: InspectorEntry | null) =>
    entry ? (
      <PlayButton
        label={`Play “${entry.surface}”`}
        playing={playing === `word:${entry.tokenIndex}`}
        onPlay={() =>
          void (async () =>
            play(`word:${entry.tokenIndex}`, {
              clip:
                entry.surface.toLocaleLowerCase() === entry.lemma.toLocaleLowerCase()
                  ? await clipId("word", wordClipText(entry.lemma, entry.article))
                  : undefined,
              text: entry.surface,
            }))()
        }
      />
    ) : null;

  const sentenceButton = useCallback(
    (sent: number, text: string) => (
      <PlayButton
        label="Play the sentence"
        playing={playing === `sent:${sent}`}
        onPlay={() =>
          void (async () =>
            play(`sent:${sent}`, {
              clip: starter?.has(text) ? await clipId("sentence", text) : undefined,
              text,
            }))()
        }
      />
    ),
    [play, playing, starter],
  );

  return { wordButton, sentenceButton };
}
