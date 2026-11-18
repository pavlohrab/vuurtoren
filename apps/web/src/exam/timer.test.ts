import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClock, remainingMs, useExamClock } from "./timer.js";

describe("exam clock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("formats and clamps", () => {
    expect(formatClock(65 * 60_000)).toBe("1:05:00");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
    expect(remainingMs(1000, 1500)).toBe(0);
  });

  it("counts down, pauses and fires onExpire once", () => {
    const onExpire = vi.fn();
    const { result, rerender } = renderHook(
      ({ running }) => useExamClock(3000, running, onExpire, 100),
      { initialProps: { running: true } },
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.remaining).toBeLessThanOrEqual(2000);
    rerender({ running: false });
    act(() => vi.advanceTimersByTime(5000));
    expect(onExpire).not.toHaveBeenCalled();
    rerender({ running: true });
    act(() => vi.advanceTimersByTime(2500));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(result.current.remaining).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("counts up without a limit", () => {
    const { result } = renderHook(() => useExamClock(null, true, undefined, 100));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.remaining).toBeNull();
    expect(result.current.elapsed).toBeGreaterThanOrEqual(900);
  });
});
