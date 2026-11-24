import { afterEach, describe, expect, it, vi } from "vitest";
import { installAndroidSpeech } from "./androidSpeech.js";

describe("installAndroidSpeech", () => {
  const original = Object.getOwnPropertyDescriptor(window, "speechSynthesis");
  afterEach(() => {
    delete window.VuurtorenTts;
    if (original) Object.defineProperty(window, "speechSynthesis", original);
    else delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it("does nothing outside the Android app", () => {
    const before = (window as { speechSynthesis?: unknown }).speechSynthesis;
    installAndroidSpeech();
    expect((window as { speechSynthesis?: unknown }).speechSynthesis).toBe(before);
  });

  it("speaks through Android's voice, reports the end, and offers the Dutch voice once ready", () => {
    let dutch = false;
    const tts = { hasDutch: () => dutch, speak: vi.fn(), stop: vi.fn() };
    window.VuurtorenTts = tts;
    installAndroidSpeech();
    const synth = window.speechSynthesis;
    expect(synth.getVoices()).toEqual([]);
    const changed = vi.fn();
    synth.addEventListener("voiceschanged", changed);
    dutch = true;
    window.__vuurtorenTtsReady?.(true);
    expect(changed).toHaveBeenCalledOnce();
    expect(synth.getVoices()[0]?.lang).toBe("nl-NL");

    const u = new SpeechSynthesisUtterance("de fiets");
    u.rate = 0.9;
    const ended = vi.fn();
    u.onend = ended;
    synth.speak(u);
    const [id, text, rate] = tts.speak.mock.calls[0] as [string, string, number];
    expect([text, rate]).toEqual(["de fiets", 0.9]);
    expect(synth.speaking).toBe(true);
    window.__vuurtorenTtsDone?.(id, true);
    expect(ended).toHaveBeenCalledOnce();
    expect(synth.speaking).toBe(false);
  });

  it("cancel stops the voice and ends what was speaking", () => {
    const tts = { hasDutch: () => true, speak: vi.fn(), stop: vi.fn() };
    window.VuurtorenTts = tts;
    installAndroidSpeech();
    const u = new SpeechSynthesisUtterance("hallo");
    const ended = vi.fn();
    u.onend = ended;
    window.speechSynthesis.speak(u);
    window.speechSynthesis.cancel();
    expect(tts.stop).toHaveBeenCalled();
    expect(ended).toHaveBeenCalledOnce();
  });
});
