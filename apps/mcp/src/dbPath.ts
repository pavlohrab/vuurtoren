/**
 * Where the desktop app keeps its database on this computer, the same way the app finds it:
 * the file chosen under Settings → Your data (`database` in the app's `desktop.json`), else
 * `<Documents>/Kenning/kenning.sqlite`. `KENNING_DB` overrides both.
 *
 * The app's settings folder (Tauri's config dir for `app.kenning.desktop`):
 *   Linux    $XDG_CONFIG_HOME/app.kenning.desktop (default ~/.config/…)
 *   macOS    ~/Library/Application Support/app.kenning.desktop
 *   Windows  %APPDATA%\app.kenning.desktop
 * Documents: ~/Documents; on Linux XDG_DOCUMENTS_DIR from ~/.config/user-dirs.dirs when set;
 * on Windows %USERPROFILE%\Documents.
 */
import { readFileSync } from "node:fs";
import { posix, win32 } from "node:path";

const APP_ID = "app.kenning.desktop";

export interface PathEnv {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  /** Read a text file, or null when it is not there. */
  read: (path: string) => string | null;
}

function systemPathEnv(): PathEnv {
  return {
    platform: process.platform,
    home: process.env["HOME"] ?? process.env["USERPROFILE"] ?? "",
    env: process.env,
    read: (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
  };
}

function configDir(e: PathEnv): string {
  if (e.platform === "win32") {
    return win32.join(e.env["APPDATA"] ?? win32.join(e.home, "AppData", "Roaming"), APP_ID);
  }
  if (e.platform === "darwin") {
    return posix.join(e.home, "Library", "Application Support", APP_ID);
  }
  return posix.join(e.env["XDG_CONFIG_HOME"] || posix.join(e.home, ".config"), APP_ID);
}

function documentsDir(e: PathEnv): string {
  if (e.platform === "win32") {
    return win32.join(e.env["USERPROFILE"] ?? e.home, "Documents");
  }
  if (e.platform === "linux") {
    const dirs = e.read(
      posix.join(e.env["XDG_CONFIG_HOME"] || posix.join(e.home, ".config"), "user-dirs.dirs"),
    );
    const m = dirs ? /^XDG_DOCUMENTS_DIR="([^"]+)"/m.exec(dirs) : null;
    if (m) return m[1]!.replace(/^\$HOME/, e.home);
  }
  return posix.join(e.home, "Documents");
}

/** The desktop app's database file and where that answer came from. */
export function desktopDbPath(e: PathEnv = systemPathEnv()): {
  path: string;
  from: "KENNING_DB" | "desktop app settings" | "default";
} {
  const given = e.env["KENNING_DB"]?.trim();
  if (given) return { path: given, from: "KENNING_DB" };
  const join = e.platform === "win32" ? win32.join : posix.join;
  const settings = e.read(join(configDir(e), "desktop.json"));
  if (settings) {
    try {
      const chosen = (JSON.parse(settings) as { database?: unknown }).database;
      if (typeof chosen === "string" && chosen) {
        return { path: chosen, from: "desktop app settings" };
      }
    } catch {
      // A damaged settings file: the app falls back to the default too.
    }
  }
  return { path: join(documentsDir(e), "Kenning", "kenning.sqlite"), from: "default" };
}
