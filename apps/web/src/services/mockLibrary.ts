/**
 * In-memory Library organisation for the demo and tests: text details, covers and shelves.
 * In `?demo` it also seeds a few more texts, three shelves and three image covers (drawn as
 * SVG: a PDF page, a course-book page and a photo), so the bookshelf has something to show.
 */
import type { StoredText } from "@app/db";
import type { LibraryServices, Shelf } from "./libraryTypes.js";

export interface MockLibraryDeps {
  texts: Map<string, StoredText>;
  addText: (title: string, content: string, kind: StoredText["sourceKind"], ref?: string) => string;
  lastSegments: Map<string, number>;
  /** Seed demo texts, shelves and covers (the ?demo app). */
  demo?: boolean;
}

const svg = (body: string): Blob =>
  new Blob(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">${body}</svg>`,
    ],
    { type: "image/svg+xml" },
  );

/** Grey text lines of a printed page, from y0 down. */
const lines = (x: number, y0: number, w: number, n: number, gap = 14): string =>
  Array.from({ length: n }, (_, i) => {
    const len = i % 5 === 4 ? w * 0.55 : w * (0.86 + ((i * 37) % 13) / 100);
    return `<rect x="${x}" y="${y0 + i * gap}" width="${Math.min(len, w)}" height="5" rx="2" fill="#9a958c"/>`;
  }).join("");

/** Demo cover art: image content, so literal colours are fine here. */
const DEMO_COVERS: Record<string, () => Blob> = {
  "demo-pdf": () =>
    svg(
      `<rect width="400" height="500" fill="#f7f4ec"/>` +
        `<rect x="40" y="46" width="200" height="18" rx="3" fill="#3b3a36"/>` +
        `<rect x="40" y="76" width="130" height="8" rx="3" fill="#8a857b"/>` +
        lines(40, 112, 320, 12) +
        `<rect x="40" y="290" width="150" height="10" rx="3" fill="#3b3a36"/>` +
        lines(40, 316, 320, 11),
    ),
  "demo-course": () =>
    svg(
      `<rect width="400" height="500" fill="#fbf7ef"/>` +
        `<rect x="0" y="0" width="400" height="64" fill="#d9734a"/>` +
        `<text x="34" y="44" font-family="Georgia, serif" font-size="26" fill="#fff8ee">3  Wonen</text>` +
        `<rect x="34" y="88" width="160" height="120" rx="6" fill="#e8c9a0"/>` +
        `<path d="M44 196 L96 132 L132 170 L160 146 L186 196 Z" fill="#b98a55"/>` +
        `<circle cx="160" cy="116" r="12" fill="#f4e3c4"/>` +
        lines(210, 92, 156, 8) +
        `<rect x="34" y="230" width="120" height="10" rx="3" fill="#d9734a"/>` +
        lines(34, 256, 332, 14),
    ),
  "demo-photo": () =>
    svg(
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3c98b"/><stop offset=".55" stop-color="#e59a6b"/><stop offset="1" stop-color="#7f5a6b"/></linearGradient></defs>` +
        `<rect width="400" height="500" fill="url(#s)"/>` +
        `<circle cx="280" cy="200" r="46" fill="#fbe3b5" opacity=".9"/>` +
        `<path d="M0 330 Q100 270 200 320 T400 300 V500 H0 Z" fill="#5d4a5c"/>` +
        `<path d="M0 390 Q120 340 240 380 T400 370 V500 H0 Z" fill="#3e3443"/>` +
        `<rect x="60" y="300" width="6" height="90" fill="#2c2530"/>` +
        `<rect x="50" y="300" width="70" height="4" fill="#2c2530"/>`,
    ),
};

const DEMO_TEXTS: {
  title: string;
  kind: StoredText["sourceKind"];
  ref?: string;
  content: string;
  cover?: string;
  meta?: Partial<Pick<StoredText, "author" | "note" | "level">>;
  segment?: number;
}[] = [
  {
    title: "Unit 3 · Wonen",
    kind: "paste",
    ref: "course:demo-course:3",
    content:
      "Wij wonen in een klein huis aan de rand van de stad. Het huis heeft twee slaapkamers en een tuin.\n\nIn de zomer eten we vaak buiten.",
    cover: "demo-course",
    meta: { note: "De Opmaat A2, p. 34", level: "A2" },
    segment: 1,
  },
  {
    title: "Unit 4 · Werk",
    kind: "paste",
    ref: "course:demo-course:4",
    content:
      "Mijn broer werkt in een ziekenhuis. Hij begint elke dag om zeven uur.\n\nHij vindt zijn werk zwaar, maar ook mooi.",
    meta: { note: "De Opmaat A2, p. 46", level: "A2" },
  },
  {
    title: "De verloren fiets",
    kind: "ai",
    // Long enough for three reader pages, so "Reading now" has something in the demo.
    content: Array.from(
      { length: 9 },
      () =>
        "Sanne zoekt haar fiets. Hij staat niet meer voor het station. Ze kijkt overal, maar ze ziet hem niet.\n\nEen oude man wijst naar de gracht. Daar ligt de fiets, in het water. Sanne lacht en belt haar vader op.",
    ).join("\n\n"),
    meta: { level: "A2" },
    segment: 1,
  },
  {
    title: "Briefje van de buren",
    kind: "image",
    content:
      "Beste buren, zaterdag geven wij een feestje in de tuin. Het kan een beetje laat worden.\n\nU bent van harte welkom!",
    cover: "demo-photo",
  },
  {
    title: "Nieuwe brug in Rotterdam",
    kind: "url",
    ref: "https://nos.nl/artikel/brug-rotterdam",
    content:
      "In Rotterdam is een nieuwe brug geopend. Fietsers en voetgangers kunnen nu sneller naar het centrum.\n\nDe brug is tweehonderd meter lang.",
    meta: { author: "NOS", note: "3 mei" },
  },
];

export function createMockLibrary(
  wait: () => Promise<void>,
  deps: MockLibraryDeps,
): LibraryServices {
  const { texts } = deps;
  const covers = new Map<string, Blob>();
  const shelves = new Map<string, Shelf>();
  let seq = 0;
  const id = (p: string) => `${p}-${(++seq).toString(36)}`;
  const patchText = (textId: string, patch: Partial<StoredText>) => {
    const t = texts.get(textId);
    if (t) texts.set(textId, { ...t, ...patch });
  };
  const clean = (v: string | null | undefined): string | undefined => v?.trim() || undefined;

  if (deps.demo) {
    for (const [cid, draw] of Object.entries(DEMO_COVERS)) covers.set(cid, draw());
    patchText("t-weer", { coverId: "demo-pdf", note: "KNMI weekbericht" });
    const made = DEMO_TEXTS.map((d) => {
      const tid = deps.addText(d.title, d.content, d.kind, d.ref);
      patchText(tid, { ...d.meta, ...(d.cover ? { coverId: d.cover } : {}) });
      if (d.segment) deps.lastSegments.set(tid, d.segment);
      return tid;
    });
    const seed = (name: string, ids: string[]) => {
      const sid = id("shelf");
      shelves.set(sid, { id: sid, name, textIds: ids, createdAt: Date.now() });
    };
    seed("De Opmaat", [made[0]!, made[1]!, "t-weer"]);
    seed("News", [made[4]!, "t-markt"]);
    seed("Stories", [made[2]!, "t-utrecht", made[3]!]);
  }

  const shelf = (shelfId: string): Shelf => {
    const s = shelves.get(shelfId);
    if (!s) throw new Error("Shelf not found");
    return s;
  };
  const name = (n: string): string => {
    const v = n.trim().slice(0, 80);
    if (!v) throw new Error("A shelf needs a name.");
    return v;
  };

  return {
    async updateTextMeta(textId, patch) {
      await wait();
      const t = texts.get(textId);
      if (!t) throw new Error("Text not found");
      const next: StoredText = { ...t };
      if (patch.title !== undefined) {
        const original = t.importedTitle ?? t.title;
        const title = clean(patch.title);
        next.title = title ?? original;
        if (title && title !== original) next.importedTitle = original;
        else delete next.importedTitle;
      }
      for (const f of ["author", "note", "level"] as const) {
        if (patch[f] === undefined) continue;
        const v = clean(patch[f]);
        if (v) next[f] = v;
        else delete next[f];
      }
      texts.set(textId, next);
    },
    async setTextCover(textId, image) {
      await wait();
      const t = texts.get(textId);
      if (!t) throw new Error("Text not found");
      if (image && image.size > 2 * 1024 * 1024) throw new Error("The image is larger than 2 MB.");
      const next: StoredText = { ...t };
      if (image) {
        const cid = id("cover");
        covers.set(cid, image);
        next.coverId = cid;
      } else delete next.coverId;
      texts.set(textId, next);
    },
    async coverImage(coverId) {
      await wait();
      return covers.get(coverId) ?? null;
    },
    async shelves() {
      await wait();
      return [...shelves.values()].map((s) => ({ ...s, textIds: [...s.textIds] }));
    },
    async createShelf(n, textIds = []) {
      await wait();
      const sid = id("shelf");
      shelves.set(sid, { id: sid, name: name(n), textIds: [...textIds], createdAt: Date.now() });
      return sid;
    },
    async renameShelf(shelfId, n) {
      await wait();
      shelf(shelfId).name = name(n);
    },
    async deleteShelf(shelfId) {
      await wait();
      shelves.delete(shelfId);
    },
    async addToShelf(shelfId, textIds) {
      await wait();
      const s = shelf(shelfId);
      s.textIds = [...textIds, ...s.textIds.filter((t) => !textIds.includes(t))];
    },
    async removeFromShelf(shelfId, textIds) {
      await wait();
      const s = shelf(shelfId);
      s.textIds = s.textIds.filter((t) => !textIds.includes(t));
    },
  };
}
