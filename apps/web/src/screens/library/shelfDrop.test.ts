import { describe, expect, it, vi } from "vitest";
import { shelfDrop } from "../Read.js";
import { DRAG_TYPE, FROM_SHELF_TYPE } from "./LibraryItem.js";

/** A drop event as the browser gives it, with the drag's data. */
function drop(data: Record<string, string>, keys: { ctrlKey?: boolean } = {}) {
  return {
    dataTransfer: {
      types: Object.keys(data),
      getData: (t: string) => data[t] ?? "",
      dropEffect: "none",
    },
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...keys,
    preventDefault: vi.fn(),
    currentTarget: { contains: () => false },
  } as never;
}

describe("dropping a cover on a shelf", () => {
  it("moves it when it comes from another shelf, keeps it on both with Ctrl", () => {
    const onDrop = vi.fn();
    const h = shelfDrop(onDrop, () => {});
    const data = { [DRAG_TYPE]: JSON.stringify(["t1"]), [FROM_SHELF_TYPE]: "s1" };
    const over = drop(data);
    h.onDragOver(over);
    expect((over as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe("move");
    h.onDrop(drop(data));
    expect(onDrop).toHaveBeenLastCalledWith(["t1"], { from: "s1", copy: false });
    h.onDrop(drop(data, { ctrlKey: true }));
    expect(onDrop).toHaveBeenLastCalledWith(["t1"], { from: "s1", copy: true });
  });

  it("adds it when it comes from no shelf of yours", () => {
    const onDrop = vi.fn();
    const h = shelfDrop(onDrop, () => {});
    const data = { [DRAG_TYPE]: JSON.stringify(["t2"]) };
    const over = drop(data);
    h.onDragOver(over);
    expect((over as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe("copy");
    h.onDrop(drop(data));
    expect(onDrop).toHaveBeenLastCalledWith(["t2"], { from: null, copy: false });
  });
});
