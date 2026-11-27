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

/**
 * Each request to say something takes a turn. Finding a clip takes a moment, so an older
 * request can be ready after a newer one; it then stays quiet instead of cutting the newer
 * one off (a new card's word, after the last card's sentence).
 */
let turn = 0;

/** Take the next turn and stop what is playing. Say it when the request is made. */
export function claimSay(): number {
  silence();
  return ++turn;
}

/** Play `what` the best way there is; says which way it went. */
export async function say(
  what: Saying,
  rate: number,
  deps: PlayerDeps,
  mine: number = claimSay(),
): Promise<"clip" | "voice" | "none"> {
  if (what.clip) {
    const blob = await deps.clip(what.clip).catch(() => null);
    if (mine !== turn) return "none";
    if (blob) {
      try {
        await deps.playBlob(blob, rate);
        return "clip";
      } catch {
        // Not playable here (autoplay blocked, codec): try the voice.
      }
    }
  }
  if (mine !== turn) return "none";
  if (what.text && (await deps.speak(what.text, rate).catch(() => false))) return "voice";
  return "none";
}

let current: { stop: () => void } | null = null;
/** The utterance being said, kept so the browser doesn't drop it before it ends. */
let utterance: SpeechSynthesisUtterance | null = null;

function silence(): void {
  current?.stop();
  current = null;
  utterance = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Stop whatever is playing, and anything still being fetched. */
export function stopSaying(): void {
  turn++;
  silence();
}

/** The browser's player: an <audio> element for clips, the Web Speech API for the voice. */
export function browserPlayer(clip: PlayerDeps["clip"]): PlayerDeps {
  return {
    clip,
    playBlob: (blob, rate) =>
      new Promise<void>((resolve, reject) => {
        silence();
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
        const synth = window.speechSynthesis;
        // Chrome can drop an utterance spoken right after cancel(): give the cancel a moment.
        const busy = synth.speaking || synth.pending;
        silence();
        const u = new SpeechSynthesisUtterance(text);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = rate * 0.9;
        utterance = u;
        const end = () => {
          if (utterance === u) utterance = null;
          resolve(true);
        };
        u.onend = end;
        u.onerror = end;
        const go = () => {
          // Something newer took over meanwhile.
          if (utterance !== u) return resolve(true);
          // A voice left paused (Chrome, after the tab was hidden) says nothing until resumed.
          if (synth.paused) synth.resume();
          synth.speak(u);
        };
        if (busy) window.setTimeout(go, 80);
        else go();
      }),
  };
}
