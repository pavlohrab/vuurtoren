/**
 * Where synced files live: a folder you already sync, WebDAV, a GitHub repository or a Kenning
 * server. Paths are `/`-separated and relative to the place's root. Each device only writes its
 * own files (and blobs, named by content), so no two devices ever write the same path.
 */
export interface SyncStore {
  /** A short description for Settings, e.g. "WebDAV · cloud.example.org". */
  readonly label: string;
  /** Names (files and folders) directly in `dir`; empty when `dir` does not exist. */
  list(dir: string): Promise<string[]>;
  /** A file's bytes, or null when it does not exist. */
  get(path: string): Promise<Uint8Array | null>;
  /** Write a file, creating folders as needed. */
  put(path: string, bytes: Uint8Array): Promise<void>;
  /** Remove a file; nothing happens when it does not exist. */
  remove(path: string): Promise<void>;
}
