import { act, renderHook } from "@testing-library/react";
import type { PointerEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useSwipe } from "./useSwipe.js";

/** A pointer event as the card would get it. */
const ev = (x: number, y: number) =>
  ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    target: document.createElement("div"),
    currentTarget: { setPointerCapture: () => undefined },
  }) as unknown as PointerEvent<HTMLElement>;

function drag(h: ReturnType<typeof useSwipe>["handlers"], dx: number, dy: number) {
  act(() => h.onPointerDown(ev(200, 300)));
  act(() => h.onPointerMove(ev(200 + dx, 300 + dy)));
}

describe("swiping a card", () => {
  it("answers left, right and up past the threshold; a short drag springs back", () => {
    const on = { onLeft: vi.fn(), onRight: vi.fn(), onUp: vi.fn() };
    const { result } = renderHook(() => useSwipe({ enabled: true, ...on }));
    drag(result.current.handlers, -120, 10);
    expect(result.current.direction).toBe("left");
    act(() => result.current.handlers.onPointerUp(ev(80, 310)));
    expect(on.onLeft).toHaveBeenCalledOnce();
    act(() => result.current.handlers.onPointerDown(ev(200, 300)));
    act(() => result.current.handlers.onPointerUp(ev(330, 290)));
    expect(on.onRight).toHaveBeenCalledOnce();
    act(() => result.current.handlers.onPointerDown(ev(200, 300)));
    act(() => result.current.handlers.onPointerUp(ev(210, 150)));
    expect(on.onUp).toHaveBeenCalledOnce();
    act(() => result.current.handlers.onPointerDown(ev(200, 300)));
    act(() => result.current.handlers.onPointerUp(ev(240, 300)));
    expect(on.onLeft).toHaveBeenCalledOnce();
    expect(on.onRight).toHaveBeenCalledOnce();
    expect(result.current.direction).toBeNull();
  });

  it("does nothing while the answer is hidden", () => {
    const on = { onLeft: vi.fn(), onRight: vi.fn(), onUp: vi.fn() };
    const { result } = renderHook(() => useSwipe({ enabled: false, ...on }));
    act(() => result.current.handlers.onPointerDown(ev(200, 300)));
    act(() => result.current.handlers.onPointerUp(ev(0, 300)));
    expect(on.onLeft).not.toHaveBeenCalled();
    expect(result.current.style).toBeUndefined();
  });
});
