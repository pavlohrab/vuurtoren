/**
 * Sync files on a Kenning server: the place devices that keep their own data sync through
 * (`/api/sync`). The server only stores files: they are sealed on the devices, and it cannot
 * read them. Each device writes its own files; a file is replaced as a whole.
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { HttpFail } from "./http-util.js";

/** One path part: letters, digits, dot, dash, underscore; never "." or "..". */
const PART = /^[A-Za-z0-9._-]+$/;
/** Largest synced file (a device's folded events with an analysed book stay well below). */
export const MAX_SYNC_FILE_BYTES = 64 * 1024 * 1024;

/** The parts of a relative sync path, or a 400 for anything else. */
export function syncPath(path: string | null, allowEmpty = false): string[] {
  if (path === null || path === "") {
    if (allowEmpty) return [];
    throw new HttpFail(400, "A path is needed.");
  }
  const parts = path.split("/");
  if (parts.length > 8 || parts.some((p) => !PART.test(p) || p === "." || p === "..")) {
    throw new HttpFail(400, "Not a valid sync path.");
  }
  return parts;
}

export class SyncFiles {
  constructor(readonly root: string) {}

  private file(parts: string[]): string {
    return join(this.root, ...parts);
  }

  list(dir: string[]): string[] {
    try {
      return readdirSync(this.file(dir))
        .filter((n) => PART.test(n) && !n.startsWith(".tmp-"))
        .sort();
    } catch {
      return [];
    }
  }

  get(path: string[]): Buffer | null {
    try {
      if (!statSync(this.file(path)).isFile()) return null;
      return readFileSync(this.file(path));
    } catch {
      return null;
    }
  }

  /** Write through a temporary file and a rename, so a reader never sees half a file. */
  put(path: string[], bytes: Uint8Array): void {
    const target = this.file(path);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = join(dirname(target), `.tmp-${randomBytes(6).toString("hex")}`);
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
  }

  remove(path: string[]): void {
    rmSync(this.file(path), { force: true });
  }
}
