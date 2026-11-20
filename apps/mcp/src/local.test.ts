/** The MCP server on the desktop app's own database: where it is, and how it is opened. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { type PathEnv, desktopDbPath } from "./dbPath.js";
import { openLocalData } from "./localData.js";

const env = (over: Partial<PathEnv>, files: Record<string, string> = {}): PathEnv => ({
  platform: "linux",
  home: "/home/anna",
  env: {},
  read: (p) => files[p] ?? null,
  ...over,
});

describe("where the desktop app keeps its data", () => {
  it("follows KENNING_DB, then the app's settings, then Documents/Kenning", () => {
    expect(desktopDbPath(env({ env: { KENNING_DB: "/x/k.sqlite" } }))).toEqual({
      path: "/x/k.sqlite",
      from: "KENNING_DB",
    });
    const moved = env(
      {},
      { "/home/anna/.config/app.kenning.desktop/desktop.json": '{"database":"/data/k.sqlite"}' },
    );
    expect(desktopDbPath(moved)).toEqual({ path: "/data/k.sqlite", from: "desktop app settings" });
    expect(desktopDbPath(env({}))).toEqual({
      path: "/home/anna/Documents/Kenning/kenning.sqlite",
      from: "default",
    });
  });

  it("knows each system's folders", () => {
    const xdg = env(
      {},
      { "/home/anna/.config/user-dirs.dirs": 'XDG_DOCUMENTS_DIR="$HOME/Dokumente"\n' },
    );
    expect(desktopDbPath(xdg).path).toBe("/home/anna/Dokumente/Kenning/kenning.sqlite");
    const mac = env(
      { platform: "darwin", home: "/Users/anna" },
      {
        "/Users/anna/Library/Application Support/app.kenning.desktop/desktop.json":
          '{"database":"/Users/anna/K/kenning.sqlite"}',
      },
    );
    expect(desktopDbPath(mac).path).toBe("/Users/anna/K/kenning.sqlite");
    const win = env({
      platform: "win32",
      home: "C:\\Users\\anna",
      env: { USERPROFILE: "C:\\Users\\anna", APPDATA: "C:\\Users\\anna\\AppData\\Roaming" },
    });
    expect(desktopDbPath(win).path).toBe("C:\\Users\\anna\\Documents\\Kenning\\kenning.sqlite");
  });
});

describe("the desktop app's database", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kenning-mcp-"));
    file = join(dir, "kenning.sqlite");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads while the app has the file open, and writes events through the repository", async () => {
    const app = await createRepository(await createNodeDriver(file));
    await app.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    const { repo, close } = await openLocalData(file);
    expect((await repo.words("nl")).find((w) => w.key === "fiets")?.state).toBe("known");

    // A change the app makes shows at once; one the MCP server makes reaches the app's file.
    await app.append({ type: "WordStateSet", lang: "nl", key: "huis", state: "known" });
    expect((await repo.words("nl")).some((w) => w.key === "huis")).toBe(true);
    await repo.append({ type: "WordStateSet", lang: "nl", key: "boom", state: "known" });
    expect((await app.word("nl", "boom"))?.state).toBe("known");
    const devices = new Set((await app.events()).map((e) => e.deviceId));
    expect(devices).toEqual(new Set([app.deviceId]));
    await close();
    await app.close();
  });

  it("refuses a missing file, and a file of another version", async () => {
    await expect(openLocalData(join(dir, "none.sqlite"))).rejects.toThrow(/desktop app/);
    const app = await createRepository(await createNodeDriver(file));
    await app.close();
    const raw = await createNodeDriver(file);
    await raw.exec("PRAGMA user_version = 999");
    await raw.close();
    await expect(openLocalData(file)).rejects.toThrow(/different versions/);
  });
});
