/**
 * Sound in the reader: a play button for the inspected word (the recording of its dictionary
 * form, else the system voice says it as written) and, side by side,
 * one per sentence (the recorded clip of a starter or story sentence, else the system voice).
 */
import { useCallback } from "react";
import { clipId, wordClipText } from "@app/anki";
import type { InspectorEntry } from "@app/core";
import { PlayButton, useSay } from "./useSay.js";

export function useReaderAudio() {
  const { play, playing } = useSay();

  const wordButton = (entry: InspectorEntry | null) =>
    entry ? (
      <PlayButton
        label={`Play “${entry.surface}”`}
        playing={playing === `word:${entry.tokenIndex}`}
        onPlay={() =>
          void (async () =>
            play(`word:${entry.tokenIndex}`, {
              // The recording says the dictionary form ("de gracht" for grachten); the system
              // voice, where there is one, says the word as written.
              clip: await clipId("word", wordClipText(entry.lemma, entry.article)),
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
              // Starter and story sentences have a clip; any other falls back to the voice.
              clip: await clipId("sentence", text),
              text,
            }))()
        }
      />
    ),
    [play, playing],
  );

  return { wordButton, sentenceButton };
}
