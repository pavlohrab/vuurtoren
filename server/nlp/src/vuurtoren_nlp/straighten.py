"""Page geometry clean-up before OCR: find the page in a photo, flatten it, straighten it.

Three steps, each skipped when it would change nothing:

1. **Page detection and perspective.** In a photo the page is a bright four-sided shape on a
   darker background. When such a shape is found and it is clearly not the whole image (or not
   an upright rectangle), the page is cut out and warped to a flat rectangle.
2. **Deskew.** The rotation that makes the text rows sharpest (horizontal projection profile of
   the dark pixels) is searched between -10 and +10 degrees and applied when it is at least
   0.5 degrees.
3. **Dewarp.** Text lines are traced (dark pixels smeared sideways into line blobs, the centre
   of each blob per column), and one smooth surface is fitted to how far they bend. When the
   bend is at least a third of a line height, every column is shifted up or down to make the
   lines straight. This flattens the curl of a book page near its spine.

Geometry only: no binarisation, no contrast change (the OCR engines do their own). A flat,
straight scan comes out pixel for pixel unchanged. Needs OpenCV (installed with RapidOCR);
without it pages pass through untouched.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from PIL import Image

if TYPE_CHECKING:
    import numpy as np

WORK_SIDE = 1600
"""Long side (pixels) of the downscaled copy the measurements are made on."""
PAGE_MIN_AREA = 0.2
"""A page shape must cover at least this share of the photo."""
PAGE_FULL_AREA = 0.85
"""A page shape covering more than this share, upright and rectangular, is a scan: left alone."""
MAX_SKEW = 10.0
MIN_SKEW = 0.5
MIN_LINES = 8
MIN_BEND_LINES = 0.33
"""Dewarp only when the fitted bend reaches this share of the median text-line height."""


@dataclass
class Straightened:
    """The cleaned page and the steps that changed it (empty for an untouched page)."""

    image: Image.Image
    steps: list[str] = field(default_factory=list)


def available() -> bool:
    try:
        import cv2  # noqa: F401
    except ImportError:
        return False
    return True


def straighten_page(img: Image.Image) -> Straightened:
    """Flatten and straighten a page image (see the module docstring). Returns RGB or L."""
    if not available():
        return Straightened(img)
    import numpy as np

    mode = "L" if img.mode in ("L", "1", "I;16", "I") else "RGB"
    arr = np.asarray(img.convert(mode))
    steps: list[str] = []
    quad = find_page(arr)
    if quad is not None:
        arr = warp_page(arr, quad)
        steps.append("page")
    angle = skew_angle(arr)
    if abs(angle) >= MIN_SKEW:
        arr = rotate(arr, angle)
        steps.append("deskew")
    bend = bend_field(arr)
    if bend is not None:
        arr = apply_bend(arr, bend)
        steps.append("dewarp")
    if not steps:
        return Straightened(img)
    return Straightened(Image.fromarray(arr, mode), steps)


# --------------------------------------------------------------------------- helpers


def _gray(arr: np.ndarray) -> np.ndarray:
    import cv2

    return arr if arr.ndim == 2 else cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)


def _small(gray: np.ndarray, side: int = WORK_SIDE) -> tuple[np.ndarray, float]:
    """A copy whose long side is at most ``side``, and the factor it was scaled by."""
    import cv2

    scale = min(1.0, side / max(gray.shape))
    if scale == 1.0:
        return gray, 1.0
    size = (round(gray.shape[1] * scale), round(gray.shape[0] * scale))
    return cv2.resize(gray, size, interpolation=cv2.INTER_AREA), scale


def _ink(gray: np.ndarray) -> np.ndarray:
    """Dark-on-light pixels (text) as a 0/1 mask; tolerant of uneven light."""
    import cv2

    block = max(15, (min(gray.shape) // 40) | 1)
    mask = cv2.adaptiveThreshold(
        gray, 1, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, block, 15
    )
    return mask


# --------------------------------------------------------------------------- page in a photo


def _order(pts: np.ndarray) -> np.ndarray:
    """Corners as top-left, top-right, bottom-right, bottom-left."""
    import numpy as np

    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array(
        [pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
        dtype=np.float32,
    )


def _quad_of(contour: np.ndarray) -> np.ndarray | None:
    import cv2

    hull = cv2.convexHull(contour)
    peri = cv2.arcLength(hull, True)
    for eps in (0.01, 0.02, 0.03, 0.05):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype("float32")
    return None


def _angles_ok(q: np.ndarray) -> bool:
    import numpy as np

    for i in range(4):
        a, b, c = q[i - 1], q[i], q[(i + 1) % 4]
        v1, v2 = a - b, c - b
        cos = float(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9))
        if not 50 <= np.degrees(np.arccos(np.clip(cos, -1, 1))) <= 130:
            return False
    return True


def _upright_rect(q: np.ndarray, tol_deg: float = 1.5) -> bool:
    import numpy as np

    for i in range(4):
        dx, dy = q[(i + 1) % 4] - q[i]
        ang = np.degrees(np.arctan2(abs(dy), abs(dx)))
        if min(ang, 90 - ang) > tol_deg:
            return False
    return True


def find_page(arr: np.ndarray) -> np.ndarray | None:
    """Corners (full-resolution, ordered) of the page in a photo, or None to leave it as is.

    Candidates are the bright region (Otsu threshold) and closed edges (Canny); the largest
    convex four-sided shape covering at least :data:`PAGE_MIN_AREA` wins. A shape that fills
    most of the image as an upright rectangle is a scan or a tight crop, and is ignored.
    """
    import cv2
    import numpy as np

    gray = _gray(arr)
    small, scale = _small(gray, 1000)
    h, w = small.shape
    area = float(h * w)
    blur = cv2.GaussianBlur(small, (7, 7), 0)
    _, bright = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    edges = cv2.Canny(blur, 40, 120)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    best: tuple[float, np.ndarray] | None = None
    for mask in (bright, edges):
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:3]:
            q = _quad_of(c)
            if q is None:
                continue
            a = cv2.contourArea(q)
            if a < PAGE_MIN_AREA * area or not _angles_ok(_order(q)):
                continue
            if best is None or a > best[0]:
                best = (a, q)
    if best is None:
        return None
    a, q = best
    q = _order(q)
    if a > PAGE_FULL_AREA * area and _upright_rect(q):
        return None
    # A shape touching the image border on three or more sides is not a page border.
    margin = 0.01 * max(h, w)
    touching = sum(
        (
            (q[:, 0] < margin).any(),
            (q[:, 0] > w - 1 - margin).any(),
            (q[:, 1] < margin).any(),
            (q[:, 1] > h - 1 - margin).any(),
        )
    )
    if touching >= 3 and _upright_rect(q, 4.0):
        return None
    return q / scale


def warp_page(arr: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """Cut out the page and warp it to a rectangle (sides from the longer opposite edges)."""
    import cv2
    import numpy as np

    tl, tr, br, bl = quad
    width = int(round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))))
    height = int(round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))))
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], "float32")
    m = cv2.getPerspectiveTransform(quad.astype("float32"), dst)
    return cv2.warpPerspective(
        arr, m, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )


# --------------------------------------------------------------------------- deskew


def _profile_score(ink: np.ndarray, angle: float) -> float:
    import cv2
    import numpy as np

    h, w = ink.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    rot = cv2.warpAffine(ink, m, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
    rows = rot.sum(axis=1, dtype=np.float64)
    return float(np.square(np.diff(rows)).sum())


def skew_angle(arr: np.ndarray) -> float:
    """Rotation (degrees, counter-clockwise positive as in OpenCV) that levels the text rows.

    0 when the page has too little text to tell.
    """
    import numpy as np

    small, _ = _small(_gray(arr), 1000)
    ink = _ink(small)
    if ink.sum() < 0.002 * ink.size:
        return 0.0
    coarse = np.arange(-MAX_SKEW, MAX_SKEW + 0.01, 0.5)
    scores = [_profile_score(ink, a) for a in coarse]
    best = float(coarse[int(np.argmax(scores))])
    fine = np.arange(best - 0.5, best + 0.51, 0.1)
    scores = [_profile_score(ink, a) for a in fine]
    angle = float(fine[int(np.argmax(scores))])
    # A flat profile (no clear rows) gives a meaningless maximum.
    if max(scores) < 1.05 * _profile_score(ink, 0.0) and abs(angle) < 1.0:
        return 0.0
    return round(angle, 2)


def rotate(arr: np.ndarray, angle: float) -> np.ndarray:
    """Rotate by ``angle`` degrees around the centre, growing the canvas so nothing is cut."""
    import cv2
    import numpy as np

    h, w = arr.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    border: Any = (
        int(np.median(arr[0]))
        if arr.ndim == 2
        else tuple(int(v) for v in np.median(arr[0], axis=0))
    )
    return cv2.warpAffine(
        arr, m, (nw, nh), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=border
    )


# --------------------------------------------------------------------------- dewarp


def _terms(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Polynomial terms of the bend surface.

    The terms in ``y`` alone absorb each line's own height offset during the fit; they drop
    out when the surface is used, because every row is taken relative to its median.
    """
    import numpy as np

    one = np.ones_like(x)
    return np.stack(
        [one, y, y**2, y**3, x, x**2, x**3, x * y, x**2 * y, x**3 * y, x * y**2, x**2 * y**2],
        axis=1,
    )


def _line_samples(
    ink: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float] | None:
    """Points on traced text lines: x, y (normalised 0..1), the offset from the line's median
    height (pixels), the line number of each point, and the median line height. None when
    there are too few lines to tell."""
    import cv2
    import numpy as np

    h, w = ink.shape
    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    heights = stats[1:, cv2.CC_STAT_HEIGHT]
    small_glyphs = heights[(heights > 3) & (heights < h / 20)]
    if len(small_glyphs) < 50:
        return None
    char_h = float(np.median(small_glyphs))
    kx = max(3, int(char_h * 1.6))
    lines = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((1, kx), np.uint8))
    lines = cv2.morphologyEx(lines, cv2.MORPH_OPEN, np.ones((max(1, int(char_h * 0.3)), 1)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(lines, connectivity=8)
    xs: list[np.ndarray] = []
    ys: list[np.ndarray] = []
    offs: list[np.ndarray] = []
    ids: list[np.ndarray] = []
    line_hs: list[float] = []
    step = max(2, int(char_h))
    for i in range(1, n):
        x0, y0, bw, bh, _ = stats[i]
        if bw < 0.15 * w or bw < 8 * bh or bh > 4 * char_h:
            continue
        sub = labels[y0 : y0 + bh, x0 : x0 + bw] == i
        cols = np.arange(0, bw, step)
        counts = sub[:, cols].sum(axis=0)
        ok = counts > 0
        if ok.sum() < 8:
            continue
        rows = np.arange(bh)[:, None]
        centre = (sub[:, cols] * rows).sum(axis=0)[ok] / counts[ok] + y0
        cx = cols[ok] + x0
        xs.append(cx / w)
        ys.append(centre / h)
        offs.append(centre - np.median(centre))
        ids.append(np.full(len(cx), len(ids)))
        line_hs.append(float(np.median(counts[ok])))
    if len(xs) < MIN_LINES:
        return None
    return (
        np.concatenate(xs),
        np.concatenate(ys),
        np.concatenate(offs),
        np.concatenate(ids),
        float(np.median(line_hs)),
    )


def bend_field(arr: np.ndarray) -> Bend | None:
    """The bend surface fitted to the text lines, or None when the lines are straight enough
    (or too few to tell)."""
    import numpy as np

    small, scale = _small(_gray(arr))
    samples = _line_samples(_ink(small))
    if samples is None:
        return None
    x, y, off, ids, line_h = samples
    a = _terms(x, y)
    keep = np.ones(len(x), bool)
    coef = np.zeros(a.shape[1])
    ridge = 1e-3 * np.eye(a.shape[1])
    for _ in range(3):
        ak = a[keep]
        coef = np.linalg.solve(ak.T @ ak + ridge, ak.T @ off[keep])
        resid = np.abs(off - a @ coef)
        mad = float(np.median(resid[keep])) + 1e-6
        keep = resid < max(3 * mad, 1.0)
        if keep.sum() < 20:
            return None
    # How far each traced line bends according to the fit (relative to its own median).
    fit = a @ coef
    per_line = []
    for i in np.unique(ids):
        f = fit[ids == i]
        per_line.append(float(np.abs(f - np.median(f)).max()))
    if float(np.percentile(per_line, 90)) < max(MIN_BEND_LINES * line_h, 2.0):
        return None
    lo = (float(np.percentile(x, 1)), float(np.percentile(y, 1)))
    hi = (float(np.percentile(x, 99)), float(np.percentile(y, 99)))
    return Bend(coef, scale, lo, hi, 3 * line_h)


@dataclass
class Bend:
    """A fitted bend surface: polynomial coefficients at work scale, the box (fractions of the
    page) the lines covered, and the largest shift allowed (work-scale pixels)."""

    coef: np.ndarray
    scale: float
    lo: tuple[float, float]
    hi: tuple[float, float]
    limit: float


def apply_bend(arr: np.ndarray, bend: Bend) -> np.ndarray:
    """Shift every pixel column so the fitted text lines become straight.

    Outside the area the lines covered the surface is held at its edge value, not
    extrapolated.
    """
    import cv2
    import numpy as np

    h, w = arr.shape[:2]
    # Evaluate on a coarse grid and upsample: the surface is smooth.
    gh, gw = max(2, h // 16), max(2, w // 16)
    gx, gy = np.meshgrid(np.linspace(0, 1, gw), np.linspace(0, 1, gh))
    gx = np.clip(gx, bend.lo[0], bend.hi[0])
    gy = np.clip(gy, bend.lo[1], bend.hi[1])
    surf = (_terms(gx.ravel(), gy.ravel()) @ bend.coef).reshape(gh, gw)
    surf -= np.median(surf, axis=1, keepdims=True)
    surf = np.clip(surf, -bend.limit, bend.limit) / bend.scale
    dy = cv2.resize(surf.astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    map_x, map_y = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    map_y += dy
    return cv2.remap(arr, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
