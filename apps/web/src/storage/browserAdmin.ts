import { type DataAdmin, type VuurtorenRepository, databaseStats } from "@app/db";

/** The part of the web driver backup needs (see `@app/db/web`). */
export interface BackupDriver {
  exec(sql: string): Promise<Record<string, unknown>[]>;
  exportFile(): Promise<Uint8Array>;
  importFile(bytes: Uint8Array): Promise<void>;
}

/**
 * Backup/restore of the browser (OPFS) database. Reads run under the repository's lock so
 * no transaction is open while the file is copied.
 */
export function createBrowserAdmin(repo: VuurtorenRepository, driver: BackupDriver): DataAdmin {
  return {
    info: () =>
      repo.exclusive(async () => ({
        ...(await databaseStats(driver as Parameters<typeof databaseStats>[0])),
        deviceId: repo.deviceId,
      })),
    exportBackup: () => repo.exclusive(() => driver.exportFile()),
    importBackup: (bytes) => repo.exclusive(() => driver.importFile(bytes)),
  };
}
