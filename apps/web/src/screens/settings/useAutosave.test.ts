import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "./useAutosave.js";

afterEach(() => vi.useRealTimers());

describe("settings autosave", () => {
  it("saves a moment after the last change, once", async () => {
    vi.useFakeTimers();
    const save = vi.fn(() => Promise.resolve());
    const { rerender, result } = renderHook(({ d }) => useAutosave(d, save), {
      initialProps: { d: null as { fill: boolean } | null },
    });
    rerender({ d: { fill: true } });
    rerender({ d: { fill: false } });
    expect(save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(save).toHaveBeenCalledExactlyOnceWith({ fill: false });
    expect(result.current.status).toBe("saved");
  });

  it("saves a waiting change at once when the section closes", () => {
    vi.useFakeTimers();
    const save = vi.fn(() => Promise.resolve());
    const { rerender, unmount } = renderHook(({ d }) => useAutosave(d, save), {
      initialProps: { d: null as { fill: boolean } | null },
    });
    rerender({ d: { fill: true } });
    vi.advanceTimersByTime(100);
    unmount();
    expect(save).toHaveBeenCalledExactlyOnceWith({ fill: true });
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledOnce();
  });

  it("saves a waiting change when the app goes to the background; nothing when invalid", () => {
    vi.useFakeTimers();
    const save = vi.fn(() => Promise.resolve());
    const { rerender, unmount } = renderHook(({ d, valid }) => useAutosave(d, save, { valid }), {
      initialProps: { d: { n: 1 } as { n: number } | null, valid: true },
    });
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    hidden.mockRestore();
    expect(save).toHaveBeenCalledExactlyOnceWith({ n: 1 });
    rerender({ d: { n: 2 }, valid: false });
    unmount();
    expect(save).toHaveBeenCalledOnce();
  });
});
