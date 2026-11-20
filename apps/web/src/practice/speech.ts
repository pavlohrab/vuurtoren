/**
 * Text-to-speech for dictation exercises, via the browser's Web Speech API. Works only when the
 * browser offers a Dutch (nl-*) voice; callers skip dictation otherwise.
 */
import { useQuery } from "@tanstack/react-query";

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis
    ? window.speechSynthesis
    : null;
}

/** The first installed Dutch voice, or null. */
export function dutchVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  return s?.getVoices().find((v) => v.lang.toLowerCase().startsWith("nl")) ?? null;
}

/**
 * Whether a Dutch voice is available. Browsers often load voices asynchronously, so this waits
 * up to `timeoutMs` for the first `voiceschanged` event when the list is still empty.
 */
export async function dutchVoiceAvailable(timeoutMs = 1000): Promise<boolean> {
  const s = synth();
  if (!s) return false;
  if (dutchVoice()) return true;
  await new Promise<void>((resolve) => {
    const done = () => {
      s.removeEventListener?.("voiceschanged", done);
      resolve();
    };
    s.addEventListener?.("voiceschanged", done);
    setTimeout(done, timeoutMs);
  });
  return dutchVoice() !== null;
}

/** Is a Dutch voice installed? Undefined while the check runs. Asked once per session. */
export function useDutchVoice(): boolean | undefined {
  return useQuery({
    queryKey: ["dutch-voice"],
    queryFn: () => dutchVoiceAvailable(),
    staleTime: Infinity,
  }).data;
}

/** Speak `text` in Dutch, cancelling anything still playing. No-op without a voice. */
export function speakDutch(text: string): void {
  const s = synth();
  const voice = dutchVoice();
  if (!s || !voice || !text) return;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.9;
  s.speak(u);
}
