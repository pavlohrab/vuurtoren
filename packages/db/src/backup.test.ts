/** Restoring a backup: a new device id, and the backup's unsent changes still sync. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareImported } from "./backup.js";
import { createNodeDriver, createNodeSyncDb } from "./node.js";
import { createRepository } from "./repository.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kenning-backup-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A database file on device `old` with three words, the first two of them already sent. */
async function backup(synced: boolean) {
  const file = join(dir, "kenning.sqlite");
  const driver = await createNodeDriver(file);
  const repo = await createRepository(driver, { deviceId: "oldoldoldold" });
  for (const key of ["fiets", "huis", "boom"])
    await repo.append({ type: "WordStateSet", lang: "nl", key, state: "known" });
  const ids = (await repo.exportEvents()).map((e) => e.id);
  if (synced) await repo.setSyncState({ vault: "v", sent: ids[1], received: { other: "x" } });
  await driver.close();
  return { file, ids };
}

async function reopened(file: string) {
  return createRepository(await createNodeDriver(file));
}

describe("prepareImported", () => {
  it("moves the events not yet sent to the new device id, and marks the rest received", async () => {
    const { file, ids } = await backup(true);
    const db = createNodeSyncDb(file);
    prepareImported(db, "newnewnewnew");
    db.close();
    const repo = await reopened(file);
    expect(repo.deviceId).toBe("newnewnewnew");
    // The new id sends from where the old one stopped: just the third word.
    expect((await repo.exportEvents(ids[1])).map((e) => e.id)).toEqual([ids[2]]);
    expect(await repo.syncState()).toEqual({
      vault: "v",
      sent: ids[1],
      received: { other: "x", oldoldoldold: ids[1] },
    });
    // Nothing is lost: every word is still known.
    expect((await repo.word("nl", "boom"))?.state).toBe("known");
    expect((await repo.word("nl", "fiets"))?.state).toBe("known");
  });

  it("moves every event of the old id when the backup never synced", async () => {
    const { file, ids } = await backup(false);
    const db = createNodeSyncDb(file);
    prepareImported(db, "newnewnewnew");
    db.close();
    const repo = await reopened(file);
    expect((await repo.exportEvents()).map((e) => e.id)).toEqual(ids);
    expect(await repo.syncState()).toBeNull();
  });
});
