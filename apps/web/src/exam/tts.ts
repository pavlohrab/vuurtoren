/**
 * Listening fragments read aloud with the browser's Dutch voice (Web Speech API). One voice is
 * enough: speakers differ by pitch. Nothing leaves the device.
 */
import { dutchVoice } from "../practice/speech.js";

export interface SpokenLine {
  voice: "f" | "m";
  text: string;
}

/** Playback speeds offered in the UI (1 = the voice's normal speed). */
export const RATES = [0.75, 0.9, 1] as const;

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Speak the lines one after another. Resolves when the last line ends or playback is cancelled;
 * rejects when no Dutch voice is installed.
 */
export function speakLines(
  lines: readonly SpokenLine[],
  opts: { rate: number; onLine?: (index: number) => void },
): { done: Promise<void>; cancel: () => void } {
  const synth = speechSupported() ? window.speechSynthesis : null;
  const voice = dutchVoice();
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    synth?.cancel();
  };
  if (!synth || !voice) {
    return { done: Promise.reject(new Error("No Dutch voice is installed.")), cancel };
  }
  synth.cancel();
  const done = new Promise<void>((resolve) => {
    const say = (i: number) => {
      const line = lines[i];
      if (cancelled || !line) return resolve();
      opts.onLine?.(i);
      const u = new SpeechSynthesisUtterance(line.text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = opts.rate;
      u.pitch = line.voice === "m" ? 0.8 : 1.15;
      u.onend = () => setTimeout(() => say(i + 1), 350);
      u.onerror = () => resolve();
      synth.speak(u);
    };
    say(0);
  });
  return { done, cancel };
}
