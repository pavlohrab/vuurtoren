/**
 * The desktop app's own database, opened on the same computer while the app may have it open
 * too. Reads go through a read-only connection; a write (an event, the analysis cache) opens a
 * writable repository for that one call and closes it again, so every change goes through the
 * normal repository and event path and the app's file lock is never needed for long.
 *
 * The file is used only when its schema and projections are exactly what this build knows:
 * a newer or older desktop app would otherwise see its file changed under it.
 */
import { existsSync } from "node:fs";
import {
  type VuurtorenRepository,
  PROJECTION_VERSION,
  SCHEMA_VERSION,
  createRepository,
} from "@app/db";
import { createNodeDriver } from "@app/db/node";
import type { ToolRepo } from "@app/mcp-tools";

/** Why this file cannot be used as it is, or null. */
async function versionProblem(path: string): Promise<string | null> {
  const driver = await createNodeDriver(path, { readOnly: true });
  try {
    const schema = Number((await driver.exec("PRAGMA user_version"))[0]?.["user_version"] ?? 0);
    const pv = (await driver.exec("SELECT value FROM meta WHERE key = 'projection_version'"))[0];
    const device = (await driver.exec("SELECT value FROM meta WHERE key = 'device_id'"))[0];
    if (schema === 0 || !device) {
      return "Open the Vuurtoren desktop app once, so it sets up its data file.";
    }
    if (schema !== SCHEMA_VERSION || Number(pv?.["value"]) !== PROJECTION_VERSION) {
      return `The Vuurtoren desktop app and this MCP server are different versions (data schema ${schema}, this server knows ${SCHEMA_VERSION}). Update both to the same release, and open the app once.`;
    }
    return null;
  } catch (e) {
    return `This file is not Vuurtoren data: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    await driver.close();
  }
}

export interface LocalData {
  /** The tools' view of the data: reads read-only, writes through a brief writable repository. */
  repo: ToolRepo & Pick<VuurtorenRepository, "languageProfile">;
  close(): Promise<void>;
}

/** Open the desktop app's database at `path` (see dbPath.ts). */
export async function openLocalData(path: string): Promise<LocalData> {
  if (!existsSync(path)) {
    throw new Error(
      `No Vuurtoren data at ${path}. Install the Vuurtoren desktop app and open it once, or set VUURTOREN_DB to its data file (Settings → Your data shows where it is).`,
    );
  }
  const problem = await versionProblem(path);
  if (problem) throw new Error(problem);
  const reader = await createRepository(await createNodeDriver(path, { readOnly: true }));

  /** Run one write on a writable repository, then close it. One at a time. */
  let tail: Promise<unknown> = Promise.resolve();
  const write = <T>(fn: (repo: VuurtorenRepository) => Promise<T>): Promise<T> => {
    const run = tail.then(async () => {
      const again = await versionProblem(path);
      if (again) throw new Error(again);
      const repo = await createRepository(await createNodeDriver(path));
      try {
        return await fn(repo);
      } finally {
        await repo.close();
      }
    });
    tail = run.catch(() => undefined);
    return run;
  };

  const repo: LocalData["repo"] = {
    courseBlocks: (...a) => reader.courseBlocks(...a),
    courses: (...a) => reader.courses(...a),
    getText: (...a) => reader.getText(...a),
    getTexts: (...a) => reader.getTexts(...a),
    learnerModel: (...a) => reader.learnerModel(...a),
    listTexts: (...a) => reader.listTexts(...a),
    staircase: (...a) => reader.staircase(...a),
    suggestedWords: (...a) => reader.suggestedWords(...a),
    unitExercises: (...a) => reader.unitExercises(...a),
    unitWords: (...a) => reader.unitWords(...a),
    words: (...a) => reader.words(...a),
    wordsByKeys: (...a) => reader.wordsByKeys(...a),
    languageProfile: (...a) => reader.languageProfile(...a),
    append: (...a) => write((w) => w.append(...a)),
    saveTextAnalysis: (...a) => write((w) => w.saveTextAnalysis(...a)),
  };
  return { repo, close: () => reader.close() };
}
