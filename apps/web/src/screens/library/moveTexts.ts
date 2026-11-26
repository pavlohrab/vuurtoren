import type { LibraryServices, Shelf } from "../../services/libraryTypes.js";

type ShelfServices = Pick<LibraryServices, "addToShelf" | "removeFromShelf">;

/**
 * Move texts to one of your shelves (F5): onto `to`, off every other shelf of yours they were
 * on. `shelves` is how the shelves were before. Gives back the Undo, which puts the texts back
 * where they were.
 */
export async function moveTexts(
  services: ShelfServices,
  shelves: readonly Shelf[],
  to: string,
  ids: string[],
): Promise<() => Promise<void>> {
  await services.addToShelf(to, ids);
  for (const s of shelves) {
    if (s.id === to) continue;
    const on = ids.filter((id) => s.textIds.includes(id));
    if (on.length) await services.removeFromShelf(s.id, on);
  }
  return async () => {
    for (const s of shelves) {
      const on = ids.filter((id) => s.textIds.includes(id));
      if (s.id === to) {
        const off = ids.filter((id) => !on.includes(id));
        if (off.length) await services.removeFromShelf(s.id, off);
      } else if (on.length) {
        await services.addToShelf(s.id, on);
      }
    }
  };
}
