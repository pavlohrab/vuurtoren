/** Contract of the Library organisation services: text details, covers and shelves. */
import type { Shelf, TextMetaPatch } from "@app/db";

export type { Shelf, TextMetaPatch };

export interface LibraryServices {
  /**
   * Edit a text's details: title, author, source note, level. Absent fields stay; null or ""
   * clears one (a cleared title shows the imported one again). Home, the reader and search
   * read the edited title.
   */
  updateTextMeta(textId: string, patch: TextMetaPatch): Promise<void>;
  /**
   * Set a text's cover image (an already cropped 4:5 WebP, at most 2 MB) or, with null, go
   * back to the typographic cover.
   */
  setTextCover(textId: string, image: Blob | null): Promise<void>;
  /** The image behind a text's `coverId`, or null when it is missing. */
  coverImage(coverId: string): Promise<Blob | null>;
  /** The learner's shelves in creation order (text ids newest addition first). */
  shelves(): Promise<Shelf[]>;
  /** Make a shelf (optionally with texts on it); returns its id. */
  createShelf(name: string, textIds?: string[]): Promise<string>;
  renameShelf(shelfId: string, name: string): Promise<void>;
  /** Delete a shelf. Its texts stay in the Library. */
  deleteShelf(shelfId: string): Promise<void>;
  addToShelf(shelfId: string, textIds: string[]): Promise<void>;
  removeFromShelf(shelfId: string, textIds: string[]): Promise<void>;
}
