/** The name of a sync place shown in Settings ("WebDAV · cloud.example.org"). */
export type PlaceRef =
  | { kind: "server" | "webdav"; url: string }
  | { kind: "github"; repo: string }
  | { kind: "folder"; path: string };

/** The last part of a folder path ("/home/me/Sync" → "Sync"). */
function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function placeLabel(p: PlaceRef): string {
  switch (p.kind) {
    case "server":
      return `Vuurtoren server · ${new URL(p.url).host}`;
    case "webdav":
      return `WebDAV · ${new URL(p.url).host}`;
    case "github":
      return `GitHub · ${p.repo}`;
    case "folder":
      return `Folder · ${folderName(p.path)}`;
  }
}
