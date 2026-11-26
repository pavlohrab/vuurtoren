import { afterEach, describe, expect, it, vi } from "vitest";
import { androidListen, androidListenAvailable, androidStopListening } from "./androidListen.js";

function bridge(available = true) {
  const b = { available: vi.fn(() => available), start: vi.fn(), stop: vi.fn() };
  window.VuurtorenListen = b;
  return b;
}
const lastId = (b: ReturnType<typeof bridge>) => b.start.mock.calls.at(-1)?.[0] as string;

describe("androidListen", () => {
  afterEach(() => {
    delete window.VuurtorenListen;
    delete window.__vuurtorenListenDone;
  });

  it("has nothing to listen with outside the Android app", async () => {
    expect(await androidListenAvailable()).toBe(false);
    await expect(androidListen()).rejects.toThrow("This phone has no speech recognition.");
    expect(() => androidStopListening()).not.toThrow();
  });

  it("says whether the phone has a recognizer", async () => {
    bridge(true);
    expect(await androidListenAvailable()).toBe(true);
    bridge(false);
    expect(await androidListenAvailable()).toBe(false);
  });

  it("resolves with what was heard, and with an empty string when nothing was", async () => {
    const b = bridge();
    const heard = androidListen();
    window.__vuurtorenListenDone?.(lastId(b), "ik fiets naar huis", "");
    expect(await heard).toBe("ik fiets naar huis");

    const nothing = androidListen();
    window.__vuurtorenListenDone?.(lastId(b), "", "");
    expect(await nothing).toBe("");
  });

  it("rejects with a sentence for the person", async () => {
    const b = bridge();
    const denied = androidListen();
    window.__vuurtorenListenDone?.(lastId(b), "", "permission");
    await expect(denied).rejects.toThrow("The microphone isn't allowed.");

    const odd = androidListen();
    window.__vuurtorenListenDone?.(lastId(b), "", "something-new");
    await expect(odd).rejects.toThrow("Speech recognition didn't work. Try again.");
  });

  it("stops early through the bridge, and answers only the listen it belongs to", async () => {
    const b = bridge();
    const first = androidListen();
    const firstId = lastId(b);
    const second = androidListen();
    expect(lastId(b)).not.toBe(firstId);
    androidStopListening();
    expect(b.stop).toHaveBeenCalledOnce();
    window.__vuurtorenListenDone?.(lastId(b), "hallo", "");
    window.__vuurtorenListenDone?.(firstId, "", "");
    expect(await second).toBe("hallo");
    expect(await first).toBe("");
  });
});
