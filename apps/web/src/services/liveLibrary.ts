/**
 * Library organisation over the repository: TextMetaUpdated / TextCoverSet / Shelf* events and
 * cover images as blobs (browser: in the OPFS database; server: /api/blobs).
 */
import { type VuurtorenRepository, createUlidGenerator } from "@app/db";
import type { NlpClient } from "@app/nlp-client";
import type { LibraryServices } from "./libraryTypes.js";

export interface LiveLibraryDeps {
  repo: Pick<
    VuurtorenRepository,
    "append" | "shelves" | "putBlob" | "getBlob" | "getText" | "listTexts"
  >;
  /** Called with the text id after its details changed (drops cached reading views). */
  forget?: (textId: string) => void;
}

const bytesOf = async (b: Blob): Promise<Uint8Array> => new Uint8Array(await b.arrayBuffer());

export function createLiveLibrary(deps: LiveLibraryDeps): LibraryServices & {
  /**
   * After importing a PDF or a photo: its first page (or the photo) as the cover, made by the
   * language server. Best effort: a failure leaves the typographic cover.
   */
  autoCover(textId: string, file: Blob, filename: string, nlp: NlpClient): Promise<void>;
} {
  const { repo } = deps;
  const nextId = createUlidGenerator();
  const name = (s: string): string => {
    const n = s.trim().slice(0, 80);
    if (!n) throw new Error("A shelf needs a name.");
    return n;
  };
  const setCover = async (textId: string, image: Blob | null): Promise<void> => {
    const blobId = image ? await repo.putBlob(await bytesOf(image), image.type) : null;
    await repo.append({ type: "TextCoverSet", textId, blobId });
  };

  return {
    async updateTextMeta(textId, patch) {
      await repo.append({ type: "TextMetaUpdated", textId, patch });
      deps.forget?.(textId);
    },
    setTextCover: setCover,
    async coverImage(coverId) {
      const b = await repo.getBlob(coverId);
      return b ? new Blob([b.bytes as BlobPart], { type: b.type }) : null;
    },
    shelves: () => repo.shelves(),
    async createShelf(n, textIds = []) {
      const shelfId = nextId();
      await repo.append({ type: "ShelfCreated", shelfId, name: name(n) });
      if (textIds.length) await repo.append({ type: "ShelfTextAdded", shelfId, textIds });
      return shelfId;
    },
    async renameShelf(shelfId, n) {
      await repo.append({ type: "ShelfRenamed", shelfId, name: name(n) });
    },
    async deleteShelf(shelfId) {
      await repo.append({ type: "ShelfDeleted", shelfId });
    },
    async addToShelf(shelfId, textIds) {
      if (textIds.length) await repo.append({ type: "ShelfTextAdded", shelfId, textIds });
    },
    async removeFromShelf(shelfId, textIds) {
      if (textIds.length) await repo.append({ type: "ShelfTextRemoved", shelfId, textIds });
    },
    async autoCover(textId, file, filename, nlp) {
      try {
        await setCover(textId, await nlp.thumbnail(file, filename));
      } catch {
        // No cover: the typographic one stays (older language server, unreadable page).
      }
    },
  };
}
