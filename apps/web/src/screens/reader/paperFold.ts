/**
 * The paper turn (mock-reader-book-2.html): a corner of the page follows the finger. The page is
 * cut along the line halfway between the corner C and the finger P, at right angles to C–P. What
 * lies past that line is mirrored over it: the flap, the back of the paper. No DOM here except
 * the SVG shading string, so the geometry can be tested.
 */
export type Pt = [number, number];

export interface Fold {
  /** The fold's unit normal, pointing to the corner. */
  n: Pt;
  /** The middle of corner and finger: on the fold. */
  m: Pt;
  /** The part of the page that stays, in page order (clip it to this). */
  keep: Pt[];
  /** The part that lifts, and where it lands mirrored (the flap). */
  cut: Pt[];
  flap: Pt[];
}

/** Fold the page `x0 … x0 + w` × `0 … h` with its corner `c` pulled to `p`. */
export function fold(w: number, h: number, x0: number, c: Pt, p: Pt): Fold {
  const dx = c[0] - p[0];
  const dy = c[1] - p[1];
  const len = Math.hypot(dx, dy) || 1;
  const n: Pt = [dx / len, dy / len];
  const m: Pt = [(c[0] + p[0]) / 2, (c[1] + p[1]) / 2];
  const side = (q: Pt) => (q[0] - m[0]) * n[0] + (q[1] - m[1]) * n[1];
  const poly: Pt[] = [
    [x0, 0],
    [x0 + w, 0],
    [x0 + w, h],
    [x0, h],
  ];
  const keep: Pt[] = [];
  const cut: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % 4]!;
    const sa = side(a);
    const sb = side(b);
    (sa <= 0 ? keep : cut).push(a);
    if (sa <= 0 !== sb <= 0) {
      const t = sa / (sa - sb);
      const q: Pt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      keep.push(q);
      cut.push(q);
    }
  }
  const mirror = (q: Pt): Pt => {
    const s = side(q);
    return [q[0] - 2 * s * n[0], q[1] - 2 * s * n[1]];
  };
  return { n, m, keep, cut, flap: cut.map(mirror) };
}

/** A CSS clip-path for a polygon (an empty one hides everything). */
export function clipOf(points: readonly Pt[]): string {
  if (points.length < 3) return "polygon(0 0, 0 0, 0 0)";
  return `polygon(${points.map((q) => `${q[0].toFixed(1)}px ${q[1].toFixed(1)}px`).join(", ")})`;
}

const pts = (a: readonly Pt[]) => a.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ");

/**
 * The light and shade of a fold, as SVG: a shadow on the page under it, and the flap. `back` is
 * the paper's colour when the flap is drawn here (a single page: plain paper); null when the
 * next page shows through the flap (a spread) and only its shading is drawn.
 */
export function foldShading(f: Fold, back: string | null, dark: boolean): string {
  if (f.cut.length < 3) return "";
  const [mx, my] = f.m;
  const [nx, ny] = f.n;
  const sh = dark ? 0.55 : 0.3;
  const line = (id: string, d: number, stops: string) =>
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${mx.toFixed(1)}" y1="${my.toFixed(1)}" x2="${(mx + nx * d).toFixed(1)}" y2="${(my + ny * d).toFixed(1)}">${stops}</linearGradient>`;
  return `<defs>${line("pf-s", 70, `<stop offset="0" stop-color="#000" stop-opacity="${sh}"/><stop offset="1" stop-color="#000" stop-opacity="0"/>`)}${line("pf-c", -44, `<stop offset="0" stop-color="#000" stop-opacity="${dark ? 0.5 : 0.24}"/><stop offset=".5" stop-color="#fff" stop-opacity="${dark ? 0.03 : 0.14}"/><stop offset="1" stop-color="#000" stop-opacity="0"/>`)}${back ? line("pf-f", -170, `<stop offset="0" stop-color="${back}"/><stop offset=".4" stop-color="${back}"/><stop offset="1" stop-color="#fff" stop-opacity="${dark ? 0.05 : 0.5}"/>`) : ""}</defs><polygon points="${pts(f.cut)}" fill="url(#pf-s)"/>${back ? `<polygon points="${pts(f.flap)}" fill="${back}"/><polygon points="${pts(f.flap)}" fill="url(#pf-f)"/>` : ""}<polygon points="${pts(f.flap)}" fill="url(#pf-c)"/>`;
}
