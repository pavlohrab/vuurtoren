import { describe, expect, it, vi } from "vitest";
import { shelfDrop } from "../Read.js";
import { DRAG_TYPE, FROM_SHELF_TYPE, STORY_TYPE } from "./LibraryItem.js";

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
  it("moves it, from another shelf or from none; Ctrl doesn't copy (Pavlo, F5)", () => {
    const onDrop = vi.fn();
    const h = shelfDrop(onDrop, () => {});
    const data = { [DRAG_TYPE]: JSON.stringify(["t1"]), [FROM_SHELF_TYPE]: "s1" };
    const over = drop(data);
    h.onDragOver(over);
    expect((over as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe("move");
    h.onDrop(drop(data, { ctrlKey: true }));
    expect(onDrop).toHaveBeenLastCalledWith(["t1"], { from: "s1" });
    const loose = { [DRAG_TYPE]: JSON.stringify(["t2"]) };
    h.onDrop(drop(loose));
    expect(onDrop).toHaveBeenLastCalledWith(["t2"], { from: null });
  });

  it("takes a story too: it has no text yet, so the drop says which story", () => {
    const onDrop = vi.fn();
    const h = shelfDrop(onDrop, () => {});
    const data = { [STORY_TYPE]: "klaas-vaak" };
    const over = drop(data);
    h.onDragOver(over);
    expect((over as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe("move");
    h.onDrop(drop(data));
    expect(onDrop).toHaveBeenLastCalledWith([], { from: null, story: "klaas-vaak" });
  });
});
