import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FEEL, readFeel, writeFeel } from "./feel.js";

afterEach(() => localStorage.clear());

describe("how Practice reacts", () => {
  it("is all on by default except the buzz", () => {
    expect(readFeel()).toEqual(DEFAULT_FEEL);
    expect(DEFAULT_FEEL).toMatchObject({
      sayDutch: true,
      sounds: true,
      movement: true,
      sayOnCard: true,
      vibrate: false,
    });
  });

  it("remembers a change and ignores what isn't a setting", () => {
    writeFeel({ ...DEFAULT_FEEL, sounds: false });
    expect(readFeel().sounds).toBe(false);
    localStorage.setItem("vuurtoren.practice.feel", JSON.stringify({ sounds: "loud", bogus: 1 }));
    expect(readFeel()).toEqual(DEFAULT_FEEL);
  });
});

/** A stand-in AudioContext. It starts suspended, like one made outside a tap. */
class FakeAudio {
  static made: FakeAudio[] = [];
  state: AudioContextState = "suspended";
  currentTime = 5;
  destination = {};
  starts: number[] = [];
  resumes = 0;
  /** Lets the pending resume() finish; the test decides when. */
  wake: () => void = () => undefined;
  constructor() {
    FakeAudio.made.push(this);
  }
  resume() {
    this.resumes++;
    return new Promise<void>((ok) => {
      this.wake = () => {
        this.state = "running";
        ok();
      };
    });
  }
  createDynamicsCompressor() {
    return { threshold: { value: 0 }, ratio: { value: 0 }, connect: () => undefined };
  }
  createOscillator() {
    const frequency = {
      value: 0,
      setValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
    };
    return {
      type: "",
      frequency,
      connect: (g: unknown) => g,
      start: (t: number) => this.starts.push(t),
      stop: () => undefined,
    };
  }
  createGain() {
    const gain = {
      setValueAtTime: () => undefined,
      linearRampToValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
    };
    return { gain, connect: (n: unknown) => n };
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return { buffer: null, connect: () => undefined, start: () => undefined };
  }
}

const settle = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

describe("the sounds", () => {
  beforeEach(() => {
    vi.resetModules();
    FakeAudio.made = [];
    vi.stubGlobal("AudioContext", FakeAudio);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("wait for the audio to wake, then play a little ahead", async () => {
    const { play } = await import("./feel.js");
    play("right");
    const c = FakeAudio.made[0]!;
    expect(c.starts).toEqual([]);
    c.wake();
    await settle();
    expect(c.starts).toHaveLength(3);
    expect(c.starts[0]).toBeGreaterThan(5);
  });

  it("don't play late when the audio took too long to wake", async () => {
    vi.useFakeTimers();
    const { play } = await import("./feel.js");
    play("wrong");
    vi.advanceTimersByTime(2000);
    const c = FakeAudio.made[0]!;
    c.wake();
    await settle();
    expect(c.starts).toEqual([]);
  });

  it("wake on the first key while Practice is open", async () => {
    const { useSoundUnlock } = await import("./feel.js");
    const { unmount } = renderHook(() => useSoundUnlock());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const c = FakeAudio.made[0]!;
    expect(c.resumes).toBe(1);
    c.wake();
    await settle();
    // Awake now: later keys leave it alone.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
    expect(c.resumes).toBe(1);
    unmount();
  });
});
