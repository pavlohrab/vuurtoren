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

let ctx: AudioContext | null = null;
const VOLUME = 0.6;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** One note: a frequency (or a glide from, to), its length and loudness, starting `at` s later. */
function note(f: number | [number, number], dur: number, gain: number, at = 0): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  if (Array.isArray(f)) {
    o.frequency.setValueAtTime(f[0], t);
    o.frequency.exponentialRampToValueAtTime(f[1], t + dur);
  } else o.frequency.value = f;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain * VOLUME, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.03);
}

export type Sound = "tick" | "right" | "wrong" | "done";

const SOUNDS: Record<Sound, () => void> = {
  // Soft pop: a tile placed, a pair matched.
  tick: () => note([520, 260], 0.05, 0.05),
  // Warm two notes, up.
  right: () => {
    note(523, 0.22, 0.045);
    note(659, 0.26, 0.045, 0.1);
  },
  // Two notes down, the mirror of "right" (high enough for phone speakers).
  wrong: () => {
    note(523, 0.16, 0.06);
    note(392, 0.3, 0.06, 0.13);
  },
  // Three notes up at the end of a lesson.
  done: () => [523, 659, 784].forEach((f, i) => note(f, 0.28, 0.04, i * 0.12)),
};

/** Play a sound when sounds are on (never throws: no audio just means silence). */
export function play(sound: Sound, feel: PracticeFeel = readFeel()): void {
  if (!feel.sounds) return;
  try {
    SOUNDS[sound]();
  } catch {
    // No audio here.
  }
}

/** A short buzz on a miss, when it's on and the device can. */
export function buzz(feel: PracticeFeel = readFeel()): void {
  if (feel.vibrate && typeof navigator.vibrate === "function") navigator.vibrate(40);
}
