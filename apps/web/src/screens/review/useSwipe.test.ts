import { act, renderHook } from "@testing-library/react";
import type { PointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSwipe } from "./useSwipe.js";

/** A pointer event as the card would get it. */
const ev = (x: number, y: number, t = 0) =>
  ({
    clientX: x,
    clientY: y,
    timeStamp: t,
    pointerId: 1,
    target: document.createElement("div"),
    currentTarget: { setPointerCapture: () => undefined },
  }) as unknown as PointerEvent<HTMLElement>;

/** A drag of (dx, dy) that takes `ms` (slow by default: not a flick). */
function drag(h: ReturnType<typeof useSwipe>["handlers"], dx: number, dy: number, ms = 1000) {
  act(() => h.onPointerDown(ev(200, 300, 0)));
  act(() => h.onPointerMove(ev(200 + dx, 300 + dy, ms)));
}

/** Let go at (dx, dy) from the start, then let the card fly off. */
function letGo(r: { current: ReturnType<typeof useSwipe> }, dx: number, dy: number, ms = 1000) {
  act(() => r.current.handlers.onPointerUp(ev(200 + dx, 300 + dy, ms)));
  act(() => vi.advanceTimersByTime(300));
}

describe("swiping a card", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("answers left, right and up past the threshold; a short drag springs back", () => {
    const on = { onLeft: vi.fn(), onRight: vi.fn(), onUp: vi.fn() };
    const { result } = renderHook(() => useSwipe({ enabled: true, ...on }));
    drag(result.current.handlers, -120, 10);
    expect(result.current.direction).toBe("left");
    letGo(result, -120, 10);
    expect(on.onLeft).toHaveBeenCalledOnce();
    drag(result.current.handlers, 130, -10);
    letGo(result, 130, -10);
    expect(on.onRight).toHaveBeenCalledOnce();
    drag(result.current.handlers, 10, -150);
    letGo(result, 10, -150);
    expect(on.onUp).toHaveBeenCalledOnce();
    drag(result.current.handlers, 40, 0);
    letGo(result, 40, 0);
    expect(on.onLeft).toHaveBeenCalledOnce();
    expect(on.onRight).toHaveBeenCalledOnce();
    expect(result.current.direction).toBeNull();
  });

  it("flies the card off from where it was let go, then answers", () => {
    const on = { onLeft: vi.fn(), onRight: vi.fn(), onUp: vi.fn() };
    const { result } = renderHook(() => useSwipe({ enabled: true, ...on }));
    drag(result.current.handlers, 120, 0);
    act(() => result.current.handlers.onPointerUp(ev(320, 300, 1000)));
    // Still on its way: nothing answered yet, the card moves off to the right.
    expect(on.onRight).not.toHaveBeenCalled();
    expect(result.current.leaving).toBe(true);
    expect(result.current.style?.transform).toMatch(/^translate\(\d{3,}/);
    act(() => vi.advanceTimersByTime(300));
    expect(on.onRight).toHaveBeenCalledOnce();
    expect(result.current.leaving).toBe(false);
  });

  it("a quick flick counts though it is short; the same distance slowly springs back", () => {
    const on = { onLeft: vi.fn(), onRight: vi.fn(), onUp: vi.fn() };
    const { result } = renderHook(() => useSwipe({ enabled: true, ...on }));
    drag(result.current.handlers, 50, 0, 1000);
    letGo(result, 50, 0, 1000);
    expect(on.onRight).not.toHaveBeenCalled();
    // 50 px in 40 ms.
    drag(result.current.handlers, 50, 0, 40);
    letGo(result, 60, 0, 60);
    expect(on.onRight).toHaveBeenCalledOnce();
  });

  it("a tap is not a swipe, wherever it starts (a button keeps its click)", () => {
    const on = { onLeft: vi.fn(), onRight: vi.fn(), onUp: vi.fn() };
    const { result } = renderHook(() => useSwipe({ enabled: true, ...on }));
    act(() => result.current.handlers.onPointerDown(ev(200, 300)));
    act(() => result.current.handlers.onPointerMove(ev(204, 302)));
    act(() => result.current.handlers.onPointerUp(ev(204, 302)));
    expect(result.current.direction).toBeNull();
    expect(on.onLeft).not.toHaveBeenCalled();
    expect(on.onRight).not.toHaveBeenCalled();
  });

  it("does nothing while it is turned off", () => {
    const on = { onLeft: vi.fn(), onRight: vi.fn(), onUp: vi.fn() };
    const { result } = renderHook(() => useSwipe({ enabled: false, ...on }));
    act(() => result.current.handlers.onPointerDown(ev(200, 300)));
    act(() => result.current.handlers.onPointerUp(ev(0, 300)));
    expect(on.onLeft).not.toHaveBeenCalled();
    expect(result.current.style).toBeUndefined();
  });
});
