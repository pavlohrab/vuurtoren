import { afterEach, describe, expect, it, vi } from "vitest";
import { installOwnVoice } from "./ownVoice.js";

const fast = { tries: 2, waitMs: 1, systemWaitMs: 1 };

describe("installOwnVoice", () => {
  const original = Object.getOwnPropertyDescriptor(window, "speechSynthesis");
  afterEach(() => {
    if (original) Object.defineProperty(window, "speechSynthesis", original);
    else delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it("keeps a system Dutch voice", async () => {
    const system = {
      getVoices: () => [{ lang: "nl-NL" }],
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: system, configurable: true });
    const server = { available: vi.fn(async () => true), say: vi.fn() };
    expect(await installOwnVoice(server, fast)).toBe(false);
    expect(window.speechSynthesis).toBe(system);
    expect(server.available).not.toHaveBeenCalled();
  });

  it("does nothing when the server has no voice", async () => {
    const server = { available: vi.fn(async () => false), say: vi.fn() };
    expect(await installOwnVoice(server, fast)).toBe(false);
    expect(server.available).toHaveBeenCalledTimes(2);
  });

  it("speaks through the server once it is up, and cancel ends it", async () => {
    let up = false;
    const server = {
      available: vi.fn(async () => up || ((up = true), false)),
      say: vi.fn(async () => new Blob(["RIFF"])),
    };
    let end: () => void = () => {};
    const stop = vi.fn();
    const play = vi.fn(() => ({ done: new Promise<void>((r) => (end = r)), stop }));
    const ready = vi.fn();
    expect(await installOwnVoice(server, { ...fast, play, onReady: ready })).toBe(true);
    expect(ready).toHaveBeenCalledOnce();
    expect(window.speechSynthesis.getVoices()[0]?.lang).toBe("nl-NL");

    const u = new SpeechSynthesisUtterance("de fiets");
    u.rate = 0.9;
    const ended = vi.fn();
    u.onend = ended;
    window.speechSynthesis.speak(u);
    expect(window.speechSynthesis.speaking).toBe(true);
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    expect(server.say).toHaveBeenCalledWith("de fiets", 0.9);
    end();
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
    expect(window.speechSynthesis.speaking).toBe(false);

    const v = new SpeechSynthesisUtterance("hallo");
    const vEnded = vi.fn();
    v.onend = vEnded;
    window.speechSynthesis.speak(v);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    window.speechSynthesis.cancel();
    expect(stop).toHaveBeenCalled();
    expect(vEnded).toHaveBeenCalledOnce();
  });

  it("reports an error when the server cannot say it", async () => {
    const server = {
      available: async () => true,
      say: async () => Promise.reject(new Error("503")),
    };
    await installOwnVoice(server, fast);
    const u = new SpeechSynthesisUtterance("x");
    const failed = vi.fn();
    u.onerror = failed;
    window.speechSynthesis.speak(u);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  });
});
