import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, useLongPress } from "./useLongPress.js";

function Cover({ onLong, onClick }: { onLong: () => void; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} {...useLongPress(onLong)}>
      Cover
    </button>
  );
}

describe("useLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const onLong = vi.fn();
    const onClick = vi.fn();
    render(<Cover onLong={onLong} onClick={onClick} />);
    return { onLong, onClick, b: screen.getByRole("button") };
  };

  it("fires after holding a finger down, and the click after it does nothing", () => {
    const { onLong, onClick, b } = setup();
    fireEvent.pointerDown(b, { pointerType: "touch", clientX: 5, clientY: 5 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    expect(onLong).toHaveBeenCalledOnce();
    fireEvent.pointerUp(b);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("a short tap is a click", () => {
    const { onLong, onClick, b } = setup();
    fireEvent.pointerDown(b, { pointerType: "touch" });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerUp(b);
    fireEvent.click(b);
    expect(onLong).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("a finger that scrolls cancels it, and the mouse never starts it", () => {
    const { onLong, b } = setup();
    fireEvent.pointerDown(b, { pointerType: "touch", clientX: 0, clientY: 0 });
    fireEvent.pointerMove(b, { pointerType: "touch", clientX: 40, clientY: 0 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    fireEvent.pointerDown(b, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    expect(onLong).not.toHaveBeenCalled();
  });
});
