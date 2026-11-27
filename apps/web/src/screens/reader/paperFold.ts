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

/** Fold the page `x0 … x0 + w` × `y0 … y0 + h` with its corner `c` pulled to `p`. */
export function fold(w: number, h: number, x0: number, c: Pt, p: Pt, y0 = 0): Fold {
  const dx = c[0] - p[0];
  const dy = c[1] - p[1];
  const len = Math.hypot(dx, dy) || 1;
  const n: Pt = [dx / len, dy / len];
  const m: Pt = [(c[0] + p[0]) / 2, (c[1] + p[1]) / 2];
  const side = (q: Pt) => (q[0] - m[0]) * n[0] + (q[1] - m[1]) * n[1];
  const poly: Pt[] = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
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
 * Keep the corner where a page bound at `spineX` can reach: within the page's width of the
 * spine's end on the corner's side, and within the page's diagonal of the spine's other end.
 * Past those the page would tear off the spine (the two-radius rule of page-curl drawing).
 */
export function constrain(p: Pt, c: Pt, spineX: number, w: number, h: number, y0 = 0): Pt {
  const near: Pt = [spineX, c[1]];
  const far: Pt = [spineX, c[1] > y0 + h / 2 ? y0 : y0 + h];
  const within = (q: Pt, o: Pt, r: number): Pt => {
    const dx = q[0] - o[0];
    const dy = q[1] - o[1];
    const d = Math.hypot(dx, dy);
    return d <= r || d === 0 ? q : [o[0] + (dx / d) * r, o[1] + (dy / d) * r];
  };
  return within(within(p, near, w), far, Math.hypot(w, h));
}

/**
 * The light and shade of a fold, matte (no highlight): a soft shadow on the page underneath that
 * grows as the page lifts, and on the flap an inner shadow along the fold. `back` is the paper's
 * colour when the flap is drawn here (a single page: plain paper, a little darker than the
 * face); null when the next page shows through the flap (a spread). `lift` 0…1 is how far
 * the page has come away (1 at mid-turn).
 */
export function foldShading(
  f: Fold,
  back: string | null,
  dark: boolean,
  lift = 0.5,
  grain: string | null = null,
): string {
  if (f.cut.length < 3) return "";
  const [mx, my] = f.m;
  const [nx, ny] = f.n;
  const k = Math.max(0, Math.min(1, lift));
  const outer = 24 + 70 * k;
  const sh = (dark ? 0.5 : 0.22) * (0.55 + 0.45 * k);
  const line = (id: string, d: number, stops: string) =>
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${mx.toFixed(1)}" y1="${my.toFixed(1)}" x2="${(mx + nx * d).toFixed(1)}" y2="${(my + ny * d).toFixed(1)}">${stops}</linearGradient>`;
  const defs =
    line(
      "pf-s",
      outer,
      `<stop offset="0" stop-color="#000" stop-opacity="${sh.toFixed(3)}"/><stop offset=".35" stop-color="#000" stop-opacity="${(sh * 0.45).toFixed(3)}"/><stop offset="1" stop-color="#000" stop-opacity="0"/>`,
    ) +
    line(
      "pf-c",
      -60,
      `<stop offset="0" stop-color="#000" stop-opacity="${dark ? 0.42 : 0.2}"/><stop offset=".25" stop-color="#000" stop-opacity="${dark ? 0.18 : 0.07}"/><stop offset="1" stop-color="#000" stop-opacity="0"/>`,
    ) +
    line(
      "pf-e",
      -200,
      `<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${dark ? 0.12 : 0.06}"/>`,
    );
  const flap = pts(f.flap);
  // The back of the paper has the same grain as its face.
  const grainDef = grain
    ? `<pattern id="pf-g" patternUnits="userSpaceOnUse" width="256" height="256"><image href="${grain}" width="256" height="256"/></pattern>`
    : "";
  const grainFill = back && grain ? `<polygon points="${flap}" fill="url(#pf-g)"/>` : "";
  return `<defs>${defs}${grainDef}</defs><polygon points="${pts(f.cut)}" fill="url(#pf-s)"/>${back ? `<polygon points="${flap}" fill="${back}"/>${grainFill}<polygon points="${flap}" fill="url(#pf-e)"/>` : ""}<polygon points="${flap}" fill="url(#pf-c)"/>`;
}
