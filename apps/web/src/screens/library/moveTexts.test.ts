import { describe, expect, it } from "vitest";
import type { Shelf } from "../../services/libraryTypes.js";
import { moveTexts } from "./moveTexts.js";

/** Shelves in memory, as the services keep them. */
function fake(start: Record<string, string[]>) {
  const on = new Map(Object.entries(start).map(([k, v]) => [k, new Set(v)]));
  const services = {
    addToShelf: async (s: string, ids: string[]) => ids.forEach((id) => on.get(s)!.add(id)),
    removeFromShelf: async (s: string, ids: string[]) => ids.forEach((id) => on.get(s)!.delete(id)),
  };
  const shelves = (): Shelf[] =>
    [...on].map(([id, set]) => ({ id, name: id, textIds: [...set].sort(), createdAt: 0 }));
  return { services, shelves };
}

describe("moveTexts", () => {
  it("moves texts off the other shelves, and Undo puts them back", async () => {
    const f = fake({ a: ["t1", "t2"], b: ["t1"], c: ["t3"] });
    const before = f.shelves();
    const undo = await moveTexts(f.services, before, "c", ["t1", "t3"]);
    expect(f.shelves().map((s) => s.textIds)).toEqual([["t2"], [], ["t1", "t3"]]);
    await undo();
    expect(f.shelves()).toEqual(before);
  });
});
