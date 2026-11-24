/**
 * The Dutch voice on Android. The WebView has no `speechSynthesis`, so without a server (and so
 * without the recordings) the phone was silent: the word, the sentence, dictation and the exam's
 * listening all fell back to a voice that did not exist. The app (MainActivity.kt) offers
 * Android's own text-to-speech as `window.VuurtorenTts`; this turns it into the small part of
 * `speechSynthesis` the app uses (getVoices, speak, cancel, voiceschanged), so every caller
 * works unchanged.
 */

declare global {
  interface Window {
    VuurtorenTts?: {
      hasDutch(): boolean;
      speak(id: string, text: string, rate: number): void;
      stop(): void;
    };
    __vuurtorenTtsReady?: (dutch: boolean) => void;
    __vuurtorenTtsDone?: (id: string, ok: boolean) => void;
  }
}

/** The one voice it offers: the system's Dutch voice. */
const DUTCH = {
  name: "Android (Nederlands)",
  lang: "nl-NL",
  voiceURI: "android-tts-nl",
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

/** Install the bridge as `speechSynthesis`; nothing outside the Android app. */
export function installAndroidSpeech(): void {
  const tts = window.VuurtorenTts;
  if (!tts) return;
  const target = new EventTarget();
  const pending = new Map<string, Utterance>();
  let n = 0;
  const finish = (id: string, ok: boolean) => {
    const u = pending.get(id);
    if (!u) return;
    pending.delete(id);
    const e = new Event(ok ? "end" : "error");
    (ok ? u.onend : u.onerror)?.call(u, e);
    u.dispatchEvent(e);
  };
  window.__vuurtorenTtsDone = finish;
  window.__vuurtorenTtsReady = () => target.dispatchEvent(new Event("voiceschanged"));

  const synthesis = {
    getVoices: () => (tts.hasDutch() ? [DUTCH] : []),
    speak(u: Utterance) {
      const id = `u${++n}`;
      // A new utterance replaces the last one (QUEUE_FLUSH): the last one has ended.
      for (const old of [...pending.keys()]) finish(old, true);
      pending.set(id, u);
      u.onstart?.call(u, new Event("start"));
      tts.speak(id, u.text, u.rate);
    },
    cancel() {
      tts.stop();
      for (const id of [...pending.keys()]) finish(id, true);
    },
    pause() {},
    resume() {},
    get speaking() {
      return pending.size > 0;
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
}
