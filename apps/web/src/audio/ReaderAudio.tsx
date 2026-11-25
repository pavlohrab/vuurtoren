/**
 * Sound in the reader: a play button for the inspected word (the recording of its dictionary
 * form, else the system voice says it as written) and, side by side,
 * one per sentence (the recorded clip of a starter or story sentence, else the system voice).
 */
import { useCallback } from "react";
import { clipId, wordClipText } from "@app/anki";
import type { InspectorEntry } from "@app/core";
import type { Saying } from "./play.js";
import { PlayButton, useSay } from "./useSay.js";

export function useReaderAudio() {
  const { play, playing } = useSay();

  // The recording says the dictionary form ("de gracht" for grachten); the system voice, where
  // there is one, says the word as written.
  const wordSaying = async (entry: InspectorEntry): Promise<Saying> => ({
    clip: await clipId("word", wordClipText(entry.lemma, entry.article)),
    text: entry.surface,
  });
  const wordButton = (entry: InspectorEntry | null) =>
    entry ? (
      <PlayButton
        label={`Play “${entry.surface}”`}
        playing={playing === `word:${entry.tokenIndex}`}
        check={{ key: `word:${entry.lemma}:${entry.surface}`, what: () => wordSaying(entry) }}
        onPlay={() =>
          void (async () => play(`word:${entry.tokenIndex}`, await wordSaying(entry)))()
        }
      />
    ) : null;

  // Starter and story sentences have a clip; any other falls back to the voice.
  const sentenceSaying = async (text: string): Promise<Saying> => ({
    clip: await clipId("sentence", text),
    text,
  });
  const sentenceButton = useCallback(
    (sent: number, text: string) => (
      <PlayButton
        label="Play the sentence"
        playing={playing === `sent:${sent}`}
        check={{ key: `sentence:${text}`, what: () => sentenceSaying(text) }}
        onPlay={() => void (async () => play(`sent:${sent}`, await sentenceSaying(text)))()}
      />
    ),
    [play, playing],
  );

  /** Say any text with the voice (a form tapped in the card's table). */
  const say = useCallback((text: string) => void play(`say:${text}`, { text }), [play]);

  return { wordButton, sentenceButton, say };
}
