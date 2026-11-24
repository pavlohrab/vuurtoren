/**
 * Vuurtoren's own Dutch voice, for a computer without one. Most Linux desktops have no Dutch
 * system voice (the app's WebKitGTK has no speech engine at all), so words without a recording,
 * dictation and the exam's listening were silent.
 *
 * The voice model (`tts-nl`, Piper) is a pack like the others: downloaded once from
 * data.vuurtoren.app at first start. The desktop's local helper (the language server running on
 * this computer, `/speech`) turns text into sound with it; nothing goes over the internet when a
 * word is spoken. This turns it into the small part of `speechSynthesis` the app uses (getVoices,
 * speak, cancel, voiceschanged), the same way as androidSpeech.ts, so every caller works
 * unchanged.
 *
 * A system Dutch voice always wins: this installs only when none shows up. The helper may still be
 * starting (it takes a few seconds after the app opens), so it asks a few times.
 */
import { dutchVoiceAvailable } from "../practice/speech.js";

let inUse = false;

/** Is Vuurtoren's own voice the one speaking (no system Dutch voice here)? */
export function ownVoiceInUse(): boolean {
  return inUse;
}

export interface OwnVoice {
  available(): Promise<boolean>;
  say(text: string, rate: number): Promise<Blob>;
}

const OWN_VOICE = {
  name: "Vuurtoren (Nederlands)",
  lang: "nl-NL",
  voiceURI: "vuurtoren-piper-nl",
  default: true,
  localService: true,
} as unknown as SpeechSynthesisVoice;

/** An utterance as the app builds it (text, voice, rate and the end and error handlers). */
class Utterance extends EventTarget {
  text: string;
  lang = "nl-NL";
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onstart: ((e: Event) => void) | null = null;
  constructor(text = "") {
    super();
    this.text = text;
  }
}

export interface InstallOptions {
  /** Called once the voice is in place (to recheck "is there a Dutch voice?"). */
  onReady?: () => void;
  /** Health checks before giving up, and the wait between them (the server may be starting). */
  tries?: number;
  waitMs?: number;
  /** How long to wait for a system voice to show up. */
  systemWaitMs?: number;
  /** Plays a clip; resolves when it ends. The browser's <audio> by default. */
  play?: (blob: Blob) => { done: Promise<void>; stop: () => void };
}

function audioPlay(blob: Blob): { done: Promise<void>; stop: () => void } {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("The voice could not play."));
    audio.play().catch(reject);
  }).finally(() => URL.revokeObjectURL(url));
  return {
    done,
    stop: () => {
      audio.pause();
      finish();
    },
  };
}

/** Make `server` (the local helper) the Dutch voice when this computer has none. Resolves true once installed. */
export async function installOwnVoice(
  server: OwnVoice | undefined,
  opts: InstallOptions = {},
): Promise<boolean> {
  if (!server || typeof window === "undefined" || window.VuurtorenTts) return false;
  const { tries = 10, waitMs = 3000, systemWaitMs = 1500, play = audioPlay } = opts;
  if (await dutchVoiceAvailable(systemWaitMs)) return false;
  let ok = false;
  for (let i = 0; i < tries && !ok; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, waitMs));
    ok = await server.available().catch(() => false);
  }
  if (!ok || (await dutchVoiceAvailable(0))) return false;

  const target = new EventTarget();
  let current: { u: Utterance; stop?: () => void } | null = null;
  const finish = (u: Utterance, ok: boolean) => {
    if (current?.u !== u) return;
    current = null;
    const e = new Event(ok ? "end" : "error");
    (ok ? u.onend : u.onerror)?.call(u, e);
    u.dispatchEvent(e);
  };
  const synthesis = {
    getVoices: () => [OWN_VOICE],
    speak(u: Utterance) {
      if (current) {
        current.stop?.();
        finish(current.u, true);
      }
      const mine: { u: Utterance; stop?: () => void } = { u };
      current = mine;
      u.onstart?.call(u, new Event("start"));
      void server
        .say(u.text, u.rate)
        .then((blob) => {
          if (current !== mine) return;
          const p = play(blob);
          mine.stop = p.stop;
          return p.done.then(() => finish(u, true));
        })
        .catch(() => finish(u, false));
    },
    cancel() {
      if (!current) return;
      current.stop?.();
      finish(current.u, true);
    },
    pause() {},
    resume() {},
    get speaking() {
      return current !== null;
    },
    get pending() {
      return false;
    },
    get paused() {
      return false;
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    onvoiceschanged: null,
  };
  Object.defineProperty(window, "speechSynthesis", { value: synthesis, configurable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: Utterance,
    configurable: true,
    writable: true,
  });
  inUse = true;
  target.dispatchEvent(new Event("voiceschanged"));
  opts.onReady?.();
  return true;
}
