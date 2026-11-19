import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { App } from "../App.js";
import { createLiveLibrary } from "../services/liveLibrary.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices, TextListItem } from "../services/types.js";
import { cropFor } from "./library/coverImage.js";
import { searchTexts, shelfRows, sortTexts } from "./library/shelving.js";

const text = (over: Partial<TextListItem>): TextListItem => ({
  id: "t",
  title: "T",
  lang: "nl",
  sourceKind: "paste",
  createdAt: 0,
  wordCount: 300,
  analyzed: true,
  lastSegment: 0,
  coverage: 0.5,
  newTypes: 3,
  pages: null,
  ...over,
});

describe("Library logic", () => {
  it("crops covers to 4:5 inside the photo, centred, zoomed and panned", () => {
    // Landscape 1000x500: the largest 4:5 frame is 400x500, centred.
    expect(cropFor(1000, 500, 1, 0.5, 0.5)).toEqual({ x: 300, y: 0, w: 400, h: 500 });
    // Zoom 2 halves the frame; pan 0/1 reach the edges.
    expect(cropFor(1000, 500, 2, 0, 1)).toEqual({ x: 0, y: 250, w: 200, h: 250 });
    // Portrait 800x2000: frame 800x1000, panned to the top.
    expect(cropFor(800, 2000, 1, 0.5, 0)).toEqual({ x: 0, y: 0, w: 800, h: 1000 });
  });

  const a = text({ id: "a", title: "Één brug", createdAt: 3, coverage: 0.7, sourceKind: "url" });
  const b = text({
    id: "b",
    title: "appel",
    createdAt: 1,
    coverage: null,
    lastSegment: 1,
    author: "NOS",
  });
  const c = text({
    id: "c",
    title: "Zon",
    createdAt: 2,
    coverage: 0.9,
    lastSegment: 2,
    sourceRef: "course:x:1",
    note: "De Opmaat p. 3",
  });

  it("sorts by recent, title (Dutch, accent-blind) and coverage", () => {
    expect(sortTexts([a, b, c], "recent").map((t) => t.id)).toEqual(["a", "c", "b"]);
    expect(sortTexts([a, b, c], "title").map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(sortTexts([a, b, c], "coverage").map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("searches titles, authors and notes, ignoring case and accents", () => {
    expect(searchTexts([a, b, c], "een").map((t) => t.id)).toEqual(["a"]);
    expect(searchTexts([a, b, c], "nos").map((t) => t.id)).toEqual(["b"]);
    expect(searchTexts([a, b, c], "opmaat 3").map((t) => t.id)).toEqual(["c"]);
    expect(searchTexts([a, b, c], "  ")).toHaveLength(3);
  });

  it("builds the bookshelf: status rows, own shelves (empty kept), source rows", () => {
    const rows = shelfRows(
      [a, b, c],
      [
        { id: "s1", name: "Stories", textIds: ["c", "gone"], createdAt: 0 },
        { id: "s2", name: "Empty", textIds: [], createdAt: 0 },
      ],
    );
    expect(rows.map((r) => [r.name, r.texts.map((t) => t.id)])).toEqual([
      ["Reading now", ["b"]],
      ["Stories", ["c"]],
      ["Empty", []],
      ["To read", ["a"]],
      ["Finished", ["c"]],
      ["Course books", ["c"]],
      ["Web", ["a"]],
    ]);
    expect(rows.filter((r) => r.own).map((r) => r.id)).toEqual(["s1", "s2"]);
  });
});

function setup(path = "/library", services?: AppServices) {
  const s = services ?? createMockServices({ latencyMs: 0 });
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App services={s} history={history} />);
  return { services: s, history, user: userEvent.setup() };
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  await user.click((await screen.findAllByRole("button", { name: `More for ${title}` }))[0]!);
};

describe("Library screen", () => {
  it("edits a text's details from the cover menu", async () => {
    const { user } = setup();
    await openMenu(user, "Het weer");
    await user.click(await screen.findByRole("menuitem", { name: "Edit details…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit details" });
    const title = within(dialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Regen in april");
    await user.type(within(dialog).getByLabelText("Author (optional)"), "KNMI");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect((await screen.findAllByRole("link", { name: "Regen in april" }))[0]).toBeVisible();
    expect(screen.queryByRole("link", { name: "Het weer" })).toBeNull();

    // Search finds it by the new title and by the author; the imported title is offered back.
    await user.type(screen.getByLabelText("Search"), "knmi");
    expect(await screen.findByText("1 text matches")).toBeInTheDocument();
    await openMenu(user, "Regen in april");
    await user.click(await screen.findByRole("menuitem", { name: "Edit details…" }));
    const again = await screen.findByRole("dialog", { name: "Edit details" });
    expect(within(again).getByText('Imported as "Het weer"')).toBeInTheDocument();
  });

  it("shows an image cover and goes back to the plain cover from the Cover dialog", async () => {
    const services = createMockServices({ latencyMs: 0 });
    await services.setTextCover("t-weer", new Blob(["<svg/>"], { type: "image/svg+xml" }));
    const created = vi.fn(() => "blob:cover");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created }));
    const { user } = setup("/library", services);
    const cover = (await screen.findAllByRole("link", { name: "Het weer" }))[0]!;
    await waitFor(() => expect(cover.querySelector("img")).toHaveAttribute("src", "blob:cover"));

    await openMenu(user, "Het weer");
    await user.click(await screen.findByRole("menuitem", { name: "Change cover…" }));
    const dialog = await screen.findByRole("dialog", { name: "Cover" });
    expect(within(dialog).getByRole("button", { name: /Choose a photo/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Use plain cover" }));
    await waitFor(async () =>
      expect((await services.listTexts()).find((t) => t.id === "t-weer")?.coverId).toBeUndefined(),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "Het weer" })[0]!.querySelector("img")).toBeNull(),
    );
    vi.unstubAllGlobals();
  });

  it("creates a shelf, adds a text from the menu, renames and deletes the shelf", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /New shelf/ }));
    let dialog = await screen.findByRole("dialog", { name: "New shelf" });
    await user.type(within(dialog).getByLabelText("Name"), "Nieuws");
    await user.click(within(dialog).getByRole("button", { name: "Create shelf" }));
    const shelf = await screen.findByRole("region", { name: "Nieuws" });
    expect(within(shelf).getByText(/Nothing here yet/)).toBeInTheDocument();

    await openMenu(user, "Op de markt");
    await user.click(await screen.findByRole("menuitem", { name: "Add to shelf…" }));
    dialog = await screen.findByRole("dialog", { name: "Add to shelf" });
    await user.click(within(dialog).getByRole("button", { name: "Nieuws" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Nieuws" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Nieuws" })).getByRole("link", {
          name: "Op de markt",
        }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Shelf Nieuws" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename…" }));
    dialog = await screen.findByRole("dialog", { name: "Rename shelf" });
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "News");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));
    expect(await screen.findByRole("region", { name: "News" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Shelf News" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete shelf…" }));
    await user.click(await screen.findByRole("button", { name: "Delete shelf" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "News" })).toBeNull());
    expect(screen.getAllByRole("link", { name: "Op de markt" }).length).toBeGreaterThan(0);
  });

  it("puts several selected texts on a new shelf at once", async () => {
    const { user, services } = setup();
    await user.click(await screen.findByRole("button", { name: /Select/ }));
    const toRead = screen.getByRole("region", { name: "To read" });
    await user.click(within(toRead).getByRole("button", { name: "Het weer" }));
    await user.click(within(toRead).getByRole("button", { name: "Op de markt" }));
    expect(screen.getByText("2 texts selected")).toBeInTheDocument();
    const bar = screen.getByRole("region", { name: "Selection" });
    await user.click(within(bar).getByRole("button", { name: /Add to shelf/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add to shelf" });
    await user.type(within(dialog).getByLabelText("New shelf"), "Stories");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(async () =>
      expect((await services.shelves())[0]?.textIds.sort()).toEqual(["t-markt", "t-weer"]),
    );
  });

  it("switches to All texts, sorts by title, and moves through a shelf with arrow keys", async () => {
    const { user } = setup();
    const toRead = await screen.findByRole("region", { name: "To read" });
    const covers = within(toRead).getAllByRole("link", { name: /^(?!More)/ });
    // Covers are links, so middle-click and "Open in new tab" work.
    expect(covers[0]).toHaveAttribute("href", expect.stringMatching(/^\/read\/t-/));
    // One tab stop per shelf; arrows move along it.
    expect(covers.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    covers[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(covers[1]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(covers[covers.length - 1]);

    await user.click(screen.getByRole("radio", { name: "All texts" }));
    const grid = await screen.findByRole("list", { name: "All texts" });
    await user.click(screen.getByRole("combobox", { name: "Sort" }));
    await user.click(await screen.findByRole("option", { name: "Title" }));
    await waitFor(() =>
      expect(
        within(grid)
          .getAllByRole("link", { name: /^(?!More)/ })
          .map((b) => b.getAttribute("aria-label")),
      ).toEqual(["Een dag in Utrecht", "Het weer", "Op de markt"]),
    );
  });
});

describe("live library services", () => {
  it("edits details, stores a cover blob and keeps shelves through the repository", async () => {
    const repo = await createRepository(await createNodeDriver());
    await repo.append({
      type: "TextImported",
      textId: "t1",
      title: "Old",
      lang: "nl",
      source: { kind: "pdf", ref: "a.pdf" },
      content: "Hallo.",
    });
    const forgotten: string[] = [];
    const lib = createLiveLibrary({ repo, forget: (id) => forgotten.push(id) });
    await lib.updateTextMeta("t1", { title: "Nieuw", level: "A2" });
    expect(forgotten).toEqual(["t1"]);
    await lib.setTextCover("t1", new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }));
    const [t] = await repo.listTexts();
    expect(t).toMatchObject({ title: "Nieuw", level: "A2" });
    const img = await lib.coverImage(t!.coverId!);
    expect(img?.type).toBe("image/webp");
    expect(new Uint8Array(await img!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const id = await lib.createShelf("De Opmaat", ["t1"]);
    await lib.renameShelf(id, "Opmaat");
    expect(await lib.shelves()).toMatchObject([{ id, name: "Opmaat", textIds: ["t1"] }]);
    await lib.removeFromShelf(id, ["t1"]);
    expect((await lib.shelves())[0]?.textIds).toEqual([]);
    await expect(lib.createShelf("  ")).rejects.toThrow(/name/);

    // Automatic cover from the language server; a failure keeps the typographic one.
    const nlp = {
      thumbnail: async () => new Blob([new Uint8Array([7])], { type: "image/webp" }),
    } as never;
    await lib.autoCover("t1", new Blob(["%PDF"]), "a.pdf", nlp);
    expect((await repo.listTexts())[0]?.coverId).not.toBe(t!.coverId);
    const broken = { thumbnail: () => Promise.reject(new Error("404")) } as never;
    await expect(lib.autoCover("t1", new Blob(["x"]), "a.pdf", broken)).resolves.toBeUndefined();
    await repo.close();
  });
});
