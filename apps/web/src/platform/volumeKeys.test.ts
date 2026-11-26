import { afterEach, describe, expect, it, vi } from "vitest";
import { hasVolumeKeys, takeVolumeKeys } from "./volumeKeys.js";

afterEach(() => {
  delete window.VuurtorenKeys;
  delete window.__vuurtorenVolumeKey;
});

describe("volume keys", () => {
  it("are not there outside the Android app", () => {
    expect(hasVolumeKeys()).toBe(false);
    const give = takeVolumeKeys(() => {});
    expect(window.__vuurtorenVolumeKey).toBeUndefined();
    expect(() => give()).not.toThrow();
  });

  it("are taken while the reader wants them, and given back", () => {
    const setVolumeKeys = vi.fn();
    window.VuurtorenKeys = { setVolumeKeys };
    expect(hasVolumeKeys()).toBe(true);
    const turns: number[] = [];
    const give = takeVolumeKeys((d) => turns.push(d));
    expect(setVolumeKeys).toHaveBeenLastCalledWith(true);
    window.__vuurtorenVolumeKey?.(1);
    window.__vuurtorenVolumeKey?.(-1);
    expect(turns).toEqual([1, -1]);
    give();
    expect(setVolumeKeys).toHaveBeenLastCalledWith(false);
    expect(window.__vuurtorenVolumeKey).toBeUndefined();
  });
});
