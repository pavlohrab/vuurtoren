/**
 * Dutch speech to text on Android, so "Say this sentence" works on the phone without a server.
 * The app (MainActivity.kt) offers Android's own speech recognition as `window.VuurtorenListen`
 * and reports each listen back by id through `window.__vuurtorenListenDone`. This turns that
 * into three small functions. Off Android there is nothing to listen with.
 */

declare global {
  interface Window {
    VuurtorenListen?: {
      available(): boolean;
      start(id: string): void;
      stop(): void;
    };
    __vuurtorenListenDone?: (id: string, text: string, error: string) => void;
  }
}

/** What to tell the person for each of Android's short error codes. */
const MESSAGES: Record<string, string> = {
  unavailable: "This phone has no speech recognition.",
  permission: "The microphone isn't allowed.",
  network: "Speech recognition needs the internet, and it isn't there.",
  busy: "Speech recognition is busy. Try again.",
  language: "This phone can't recognise Dutch yet.",
  audio: "The microphone didn't work.",
};
const OTHER = "Speech recognition didn't work. Try again.";

const pending = new Map<string, { resolve: (text: string) => void; reject: (e: Error) => void }>();
let n = 0;

function done(id: string, text: string, error: string): void {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (error) p.reject(new Error(MESSAGES[error] ?? OTHER));
  else p.resolve(text);
}

/** True on Android when the phone has a speech recognizer. */
export async function androidListenAvailable(): Promise<boolean> {
  const bridge = typeof window === "undefined" ? undefined : window.VuurtorenListen;
  if (!bridge) return false;
  try {
    return bridge.available();
  } catch {
    return false;
  }
}

/**
 * Listen once in Dutch. Resolves with what was heard, or "" when nothing was. Rejects with an
 * Error whose message can be shown as it is. A new listen ends the one before it with "".
 */
export function androidListen(): Promise<string> {
  const bridge = typeof window === "undefined" ? undefined : window.VuurtorenListen;
  if (!bridge) return Promise.reject(new Error(MESSAGES.unavailable));
  window.__vuurtorenListenDone = done;
  const id = `l${++n}`;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    bridge.start(id);
  });
}

/** Stop listening now (the second tap on the mic). The listen resolves with what was heard. */
export function androidStopListening(): void {
  window.VuurtorenListen?.stop();
}
