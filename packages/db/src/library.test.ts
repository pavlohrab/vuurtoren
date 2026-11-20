import { afterEach, describe, expect, it } from "vitest";
import { MAX_BLOB_BYTES, projectShelves } from "./library.js";
import { createNodeDriver } from "./node.js";
import { applyEvent } from "./projections.js";
import { createRepository, type VuurtorenRepository } from "./repository.js";
import { migrate } from "./schema.js";
import type { AppEvent, StoredEvent } from "./types.js";

const open: VuurtorenRepository[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) await r.close().catch(() => undefined);
});

async function newRepo(): Promise<VuurtorenRepository> {
  let t = 1_000_000;
  const repo = await createRepository(await createNodeDriver(), {
    deviceId: "dev1",
    now: () => t++,
  });
  open.push(repo);
  return repo;
}

const imported = (textId: string, title: string): AppEvent => ({
  type: "TextImported",
  textId,
  title,
  lang: "nl",
  source: { kind: "paste" },
  content: "Een korte tekst over de trein.",
});

describe("text details (TextMetaUpdated / TextCoverSet)", () => {
  it("renames a text everywhere it is listed, and clearing goes back to the imported title", async () => {
    const repo = await newRepo();
    await repo.append(imported("t1", "Imported"));
    await repo.append({
      type: "TextMetaUpdated",
      textId: "t1",
      patch: { title: "  Mijn titel ", author: "Annie M.G. Schmidt", level: "A2" },
    });
    const [s] = await repo.listTexts();
    expect(s).toMatchObject({
      title: "Mijn titel",
      importedTitle: "Imported",
      author: "Annie M.G. Schmidt",
      level: "A2",
    });
    expect((await repo.getText("t1"))?.title).toBe("Mijn titel");

    // A later patch of one field keeps the others.
    await repo.append({ type: "TextMetaUpdated", textId: "t1", patch: { note: "NOS" } });
    expect((await repo.listTexts())[0]).toMatchObject({ title: "Mijn titel", note: "NOS" });

    await repo.append({ type: "TextMetaUpdated", textId: "t1", patch: { title: "", level: null } });
    const after = (await repo.listTexts())[0]!;
    expect(after.title).toBe("Imported");
    expect(after.importedTitle).toBeUndefined();
    expect(after.level).toBeUndefined();
    expect(after.author).toBe("Annie M.G. Schmidt");
  });

  it("is last-write-wins per field by HLC, whatever the arrival order", async () => {
    const driver = await createNodeDriver();
    await migrate(driver);
    const apply = (hlc: string, event: AppEvent) =>
      applyEvent(driver, { id: hlc, hlc, createdAt: 1, event });
    await apply("000000000000001-00000-a", imported("t1", "Imported"));
    // The newer edit arrives first; the older one must not overwrite its title.
    await apply("000000000000005-00000-b", {
      type: "TextMetaUpdated",
      textId: "t1",
      patch: { title: "Newer" },
    });
    await apply("000000000000003-00000-a", {
      type: "TextMetaUpdated",
      textId: "t1",
      patch: { title: "Older", author: "Kept" },
    });
    const rows = await driver.exec("SELECT title, author FROM text_meta");
    expect(rows[0]).toMatchObject({ title: "Newer", author: "Kept" });
    await driver.close();
  });

  it("sets and clears a cover, survives rebuild, and forgets everything on delete", async () => {
    const repo = await newRepo();
    await repo.append(imported("t1", "Imported"));
    const id = await repo.putBlob(new Uint8Array([1, 2, 3]), "image/webp");
    await repo.append({ type: "TextCoverSet", textId: "t1", blobId: id });
    expect((await repo.listTexts())[0]?.coverId).toBe(id);
    await repo.rebuild();
    expect((await repo.listTexts())[0]?.coverId).toBe(id);
    expect((await repo.getBlob(id))?.bytes).toEqual(new Uint8Array([1, 2, 3]));

    await repo.append({ type: "TextCoverSet", textId: "t1", blobId: null });
    expect((await repo.listTexts())[0]?.coverId).toBeUndefined();

    await repo.append({ type: "TextMetaUpdated", textId: "t1", patch: { title: "Renamed" } });
    await repo.append({ type: "TextDeleted", textId: "t1" });
    await repo.append(imported("t1", "Again"));
    expect((await repo.listTexts())[0]?.title).toBe("Again");
  });
});

describe("blobs", () => {
  it("are content-addressed, typed and capped", async () => {
    const repo = await newRepo();
    const bytes = new Uint8Array([9, 8, 7]);
    const id = await repo.putBlob(bytes, "image/png");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await repo.putBlob(bytes, "image/png")).toBe(id);
    expect(await repo.getBlob(id)).toEqual({ type: "image/png", bytes });
    expect(await repo.getBlob("nope")).toBeNull();
    expect(await repo.getBlob("0".repeat(64))).toBeNull();
    await expect(repo.putBlob(bytes, "text/html")).rejects.toThrow(/images/);
    await expect(repo.putBlob(new Uint8Array(MAX_BLOB_BYTES + 1), "image/webp")).rejects.toThrow(
      /2 MB/,
    );
  });
});

describe("shelves", () => {
  it("create, rename, add, remove and delete, folded in HLC order", async () => {
    const repo = await newRepo();
    await repo.append({ type: "ShelfCreated", shelfId: "s1", name: "De Opmaat" });
    await repo.append({ type: "ShelfCreated", shelfId: "s2", name: "News" });
    await repo.append({ type: "ShelfTextAdded", shelfId: "s1", textIds: ["a", "b"] });
    await repo.append({ type: "ShelfTextAdded", shelfId: "s2", textIds: ["a"] });
    await repo.append({ type: "ShelfTextAdded", shelfId: "s1", textIds: ["c"] });
    await repo.append({ type: "ShelfTextRemoved", shelfId: "s1", textIds: ["b"] });
    await repo.append({ type: "ShelfRenamed", shelfId: "s2", name: "Nieuws" });
    let shelves = await repo.shelves();
    expect(shelves.map((s) => [s.name, s.textIds])).toEqual([
      ["De Opmaat", ["c", "a"]],
      ["Nieuws", ["a"]],
    ]);
    await repo.append({ type: "ShelfDeleted", shelfId: "s1" });
    // Writes to a deleted shelf (e.g. from another device) do not bring it back.
    await repo.append({ type: "ShelfTextAdded", shelfId: "s1", textIds: ["d"] });
    shelves = await repo.shelves();
    expect(shelves.map((s) => s.id)).toEqual(["s2"]);
    await repo.rebuild();
    expect(await repo.shelves()).toEqual(shelves);
  });

  it("orders by HLC, not by arrival (id) order", () => {
    const ev = (id: string, hlc: string, event: AppEvent): StoredEvent => ({
      id,
      hlc,
      deviceId: "d",
      event,
    });
    const shelves = projectShelves([
      // Arrived first but happened last.
      ev("3", "000000000000003-00000-b", { type: "ShelfRenamed", shelfId: "s", name: "Late" }),
      ev("1", "000000000000001-00000-a", { type: "ShelfCreated", shelfId: "s", name: "First" }),
      ev("2", "000000000000002-00000-a", { type: "ShelfRenamed", shelfId: "s", name: "Early" }),
    ]);
    expect(shelves[0]?.name).toBe("Late");
  });
});
