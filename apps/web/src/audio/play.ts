/**
 * Saying a word or a sentence: the audio pack's clip when there is one, else the system's Dutch
 * voice, else nothing (quietly). One sound at a time: a new one stops the last.
 */
import { dutchVoice } from "../practice/speech.js";

/** What to say: a clip id of the audio pack and the text (for the system voice). */
export interface Saying {
  clip?: string | undefined;
  text?: string | undefined;
}

export interface PlayerDeps {
  /** The clip of an id, or null when the pack has none. */
  clip: (id: string) => Promise<Blob | null>;
  /** Play a clip; resolves when it ends, rejects when it cannot play. */
  playBlob: (blob: Blob, rate: number) => Promise<void>;
  /** Say text with the system voice; resolves false when there is no Dutch voice. */
  speak: (text: string, rate: number) => Promise<boolean>;
}

/** Play `what` the best way there is; says which way it went. */
export async function say(
  what: Saying,
  rate: number,
  deps: PlayerDeps,
): Promise<"clip" | "voice" | "none"> {
  if (what.clip) {
    const blob = await deps.clip(what.clip).catch(() => null);
    if (blob) {
      try {
        await deps.playBlob(blob, rate);
        return "clip";
      } catch {
        // Not playable here (autoplay blocked, codec): try the voice.
      }
    }
  }
  if (what.text && (await deps.speak(what.text, rate).catch(() => false))) return "voice";
  return "none";
}

let current: { stop: () => void } | null = null;

/** Stop whatever is playing. */
export function stopSaying(): void {
  current?.stop();
  current = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** The browser's player: an <audio> element for clips, the Web Speech API for the voice. */
export function browserPlayer(clip: PlayerDeps["clip"]): PlayerDeps {
  return {
    clip,
    playBlob: (blob, rate) =>
      new Promise<void>((resolve, reject) => {
        stopSaying();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = rate;
        const done = (ok: boolean) => {
          URL.revokeObjectURL(url);
          if (current?.stop === stop) current = null;
          if (ok) resolve();
          else reject(new Error("The clip could not play."));
        };
        const stop = () => {
          audio.pause();
          done(true);
        };
        current = { stop };
        audio.onended = () => done(true);
        audio.onerror = () => done(false);
        audio.play().catch(() => done(false));
      }),
    speak: (text, rate) =>
      new Promise<boolean>((resolve) => {
        const voice = dutchVoice();
        if (!voice || typeof window === "undefined" || !("speechSynthesis" in window))
          return resolve(false);
        stopSaying();
        const u = new SpeechSynthesisUtterance(text);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = rate * 0.9;
        u.onend = () => resolve(true);
        u.onerror = () => resolve(true);
        window.speechSynthesis.speak(u);
      }),
  };
}
