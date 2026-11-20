/**
 * Sync files on a Vuurtoren server: the place devices that keep their own data sync through
 * (`/api/sync`). The server only stores files: they are sealed on the devices, and it cannot
 * read them. Each device writes its own files; a file is replaced as a whole.
 *
 * A sync token writes only its own device's folder and the shared images (`syncWriteProblem`);
 * all files together stay within a size quota.
 */
import {
  lstatSync,
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
/** All sync files together, unless VUURTOREN_SYNC_QUOTA_MB says otherwise. */
const DEFAULT_SYNC_QUOTA_BYTES = 2048 * 1024 * 1024;
const TMP = ".tmp-";

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

/** What a sync token may do, as far as writing goes. */
export interface SyncTokenRights {
  /** The device folder it writes to; null until its first write there. */
  device: string | null;
  /** It may replace vault.json. */
  vault: boolean;
}

/**
 * Why a sync token may not write (PUT) or remove (DELETE) `parts`, or null. A token writes:
 *  - its own device's folder, vuurtoren/devices/<device>/… (the first folder it writes becomes
 *    its own: `claim` is then set);
 *  - images, vuurtoren/blobs/<name> (named by content; never removed);
 *  - vuurtoren/vault.json when there is none yet (the first device; `madeVault` is then set),
 *    or when the token may replace it.
 */
export function syncWriteProblem(
  parts: string[],
  method: "PUT" | "DELETE",
  rights: SyncTokenRights,
  vaultExists: boolean,
): { problem: string } | { claim?: string; madeVault?: boolean } {
  const [root, area, device] = parts;
  if (root === "vuurtoren" && area === "devices" && device && parts.length >= 4) {
    if (rights.device === device) return {};
    if (rights.device === null && method === "PUT") return { claim: device };
    return {
      problem:
        "This sync token belongs to another device. Make a sync token for this device in the server's Settings → Sync.",
    };
  }
  if (root === "vuurtoren" && area === "blobs" && parts.length === 3 && method === "PUT") return {};
  if (root === "vuurtoren" && area === "vault.json" && parts.length === 2 && method === "PUT") {
    if (!vaultExists) return { madeVault: true };
    if (rights.vault) return {};
    return {
      problem:
        "This sync token may not change the passphrase or recovery key. Use the device that started the sync data, or a sync token made for it.",
    };
  }
  return { problem: "A sync token may not change this file." };
}

export class SyncFiles {
  /** Bytes in use (null until first counted). */
  private used: number | null = null;

  constructor(
    readonly root: string,
    readonly quotaBytes: number = DEFAULT_SYNC_QUOTA_BYTES,
  ) {}

  private file(parts: string[]): string {
    return join(this.root, ...parts);
  }

  /** Total size of the files, counted once; half-written files left by a crash go. */
  private usage(): number {
    if (this.used !== null) return this.used;
    let total = 0;
    const walk = (dir: string) => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const n of names) {
        const p = join(dir, n);
        const st = lstatSync(p);
        if (st.isDirectory()) walk(p);
        else if (n.startsWith(TMP)) rmSync(p, { force: true });
        else if (st.isFile()) total += st.size;
      }
    };
    walk(this.root);
    this.used = total;
    return total;
  }

  private sizeOf(path: string): number {
    try {
      const st = statSync(path);
      return st.isFile() ? st.size : 0;
    } catch {
      return 0;
    }
  }

  list(dir: string[]): string[] {
    try {
      return readdirSync(this.file(dir))
        .filter((n) => PART.test(n) && !n.startsWith(TMP))
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

  exists(path: string[]): boolean {
    try {
      return statSync(this.file(path)).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Write through a temporary file and a rename, so a reader never sees half a file. Refused
   * (507) past the quota; the temporary file never stays behind.
   */
  put(path: string[], bytes: Uint8Array): void {
    const target = this.file(path);
    const before = this.sizeOf(target);
    const after = this.usage() - before + bytes.length;
    if (after > this.quotaBytes) {
      throw new HttpFail(
        507,
        `The sync space on this server is full (${Math.round(this.quotaBytes / 1024 / 1024)} MB). Its owner can raise VUURTOREN_SYNC_QUOTA_MB.`,
      );
    }
    mkdirSync(dirname(target), { recursive: true });
    const tmp = join(dirname(target), `${TMP}${randomBytes(6).toString("hex")}`);
    try {
      writeFileSync(tmp, bytes);
      renameSync(tmp, target);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    this.used = after;
  }

  remove(path: string[]): void {
    const target = this.file(path);
    const size = this.sizeOf(target);
    rmSync(target, { force: true });
    if (this.used !== null) this.used = Math.max(0, this.used - size);
  }
}
