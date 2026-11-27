/**
 * How Practice reacts (mock-practice-polish.html): Dutch said by itself, small sounds, movement,
 * the word said when a word card opens, a buzz on a miss. Remembered per device (localStorage),
 * all on except the buzz. Movement also stops when the system asks for less motion.
 */
import { useEffect, useState } from "react";

export interface PracticeFeel {
  /** Say Dutch words and sentences by themselves. */
  sayDutch: boolean;
  /** A tick, a soft right and not-quite, and a chime at the end. */
  sounds: boolean;
  /** Tiles that fly, a shake on a miss. */
  movement: boolean;
  /** Say the word when a word card opens (reader, Words, review). */
  sayOnCard: boolean;
  /** A short buzz on a miss (phone). */
  vibrate: boolean;
}

export const DEFAULT_FEEL: PracticeFeel = {
  sayDutch: true,
  sounds: true,
  movement: true,
  sayOnCard: true,
  vibrate: false,
};

const KEY = "vuurtoren.practice.feel";
const EVENT = "vuurtoren-practice-feel";

export function readFeel(): PracticeFeel {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<string, unknown>>;
    const out = { ...DEFAULT_FEEL };
    for (const k of Object.keys(DEFAULT_FEEL) as (keyof PracticeFeel)[])
      if (typeof raw[k] === "boolean") out[k] = raw[k];
    return out;
  } catch {
    return { ...DEFAULT_FEEL };
  }
}

export function writeFeel(p: PracticeFeel): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Blocked storage: the defaults stay.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The settings, kept up to date when they change anywhere in the app. */
export function useFeel(): PracticeFeel {
  const [feel, setFeel] = useState(readFeel);
  useEffect(() => {
    const changed = () => setFeel(readFeel());
    window.addEventListener(EVENT, changed);
    return () => window.removeEventListener(EVENT, changed);
  }, []);
  return feel;
}

/** Movement is on, and the system doesn't ask for less motion. */
export function moving(feel: PracticeFeel): boolean {
  return (
    feel.movement &&
    !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}

// --- the sounds: made with Web Audio, no files; quiet, under the Dutch voice ---
//
// Browsers start audio only from a tap or a key press. A sound in Practice often comes later:
// after the answer is saved, or from a timer. So while Practice is open the first tap or key
// makes and wakes the audio (useSoundUnlock), and a sound that finds it asleep waits for it to
// wake before it is scheduled, a little ahead, so its start isn't cut off.

let ctx: AudioContext | null = null;
/** Everything goes through a limiter, so the sounds can be as loud as the voice without crackle. */
let out: AudioNode | null = null;
/** A silent sample was played once inside a tap (WebKit starts audio only that way). */
let primed = false;
// Louder than the first round (M6: hard to hear on a phone next to the voice).
const VOLUME = 1;
const LOUDER = 3;
/** Sounds start this far ahead (s): a context that just woke up drops its first few ms. */
const LEAD = 0.03;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx || ctx.state === "closed") {
    ctx = new AC();
    primed = false;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -10;
    limit.ratio.value = 12;
    limit.connect(ctx.destination);
    out = limit;
  }
  return ctx;
}

/**
 * Wake the sounds. Call it inside a tap or a key press: that is when browsers let audio start
 * (a suspended context, Safari's "interrupted" one, an Android WebView).
 */
function wakeSounds(): void {
  try {
    const c = audio();
    if (!c) return;
    if (c.state !== "running") void c.resume().catch(() => undefined);
    if (!primed) {
      primed = true;
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    }
  } catch {
    // No audio here.
  }
}

const WAKE_ON = ["pointerdown", "keydown", "touchend"] as const;

/**
 * While mounted, a tap or a key anywhere wakes the sounds when they are asleep (the first one
 * after loading, or after the system paused the audio).
 */
export function useSoundUnlock(on = true): void {
  useEffect(() => {
    if (!on) return;
    const wake = () => {
      if (ctx?.state === "running" && primed) return;
      if (readFeel().sounds) wakeSounds();
    };
    const opts = { capture: true, passive: true } as const;
    for (const t of WAKE_ON) window.addEventListener(t, wake, opts);
    return () => {
      for (const t of WAKE_ON) window.removeEventListener(t, wake, opts);
    };
  }, [on]);
}

/** One note at `t` (s): a frequency (or a glide from, to), its length and loudness. */
function note(
  c: AudioContext,
  t: number,
  f: number | [number, number],
  dur: number,
  gain: number,
  type: OscillatorType = "triangle",
): void {
  if (!out) return;
  const o = c.createOscillator();
  const g = c.createGain();
  // Triangle: a little brighter than a sine, so a phone speaker carries it.
  o.type = type;
  if (Array.isArray(f)) {
    o.frequency.setValueAtTime(f[0], t);
    o.frequency.exponentialRampToValueAtTime(f[1], t + dur);
  } else o.frequency.value = f;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain * VOLUME * LOUDER, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.03);
}

export type Sound = "tick" | "right" | "wrong" | "done";

const SOUNDS: Record<Sound, (c: AudioContext, t: number) => void> = {
  // Soft pop: a tile placed, a pair matched.
  tick: (c, t) => note(c, t, [520, 260], 0.06, 0.06, "sine"),
  // Three bright notes, quick and rising (mock-practice-reward.html, B; Pavlo 26 Nov).
  right: (c, t) => [659, 784, 1047].forEach((f, i) => note(c, t + i * 0.07, f, 0.2, 0.04)),
  // Two notes down, the mirror of "right" (high enough for phone speakers).
  wrong: (c, t) => {
    note(c, t, 523, 0.16, 0.06);
    note(c, t + 0.13, 392, 0.3, 0.06);
  },
  // Three notes up at the end of a lesson.
  done: (c, t) => [523, 659, 784].forEach((f, i) => note(c, t + i * 0.12, f, 0.28, 0.04)),
};

/** Play a sound when sounds are on (never throws: no audio just means silence). */
export function play(sound: Sound, feel: PracticeFeel = readFeel()): void {
  if (!feel.sounds) return;
  try {
    const c = audio();
    if (!c) return;
    // Scheduled now, whether the audio is awake or not: asleep, it plays the moment it wakes.
    // (Waiting for resume() and dropping a "late" sound left the Linux app silent: there the
    // audio can take well over a second to wake, through GStreamer.)
    SOUNDS[sound](c, c.currentTime + LEAD);
    if (c.state !== "running") void c.resume().catch(() => undefined);
  } catch {
    // No audio here.
  }
}

/** A short buzz on a miss, when it's on and the device can. */
export function buzz(feel: PracticeFeel = readFeel()): void {
  if (feel.vibrate && typeof navigator.vibrate === "function") navigator.vibrate(40);
}
