"""OCR benchmark: word and character error rates of the OCR variants on your own pages.

    uv run --with rapidfuzz python scripts/ocr_bench.py DATA [--variants ...] [--per-page]

``DATA`` holds ``pages/<name>.png`` (page images, e.g. a scanned book rendered at 300 DPI) and
``gt/<name>.txt`` (a careful transcription of each page). Keep both outside git when the pages
are copyrighted. On the first run the script also makes two photo-like versions of every page
in ``photos/`` (``<name>-photo.jpg``: perspective tilt, uneven light, blur, JPEG;
``<name>-curl.jpg``: the same plus a page curl towards the spine), deterministic per page.

Variants (``--variants``, comma-separated):

* ``tess-raw``     Tesseract on the image as uploaded (no page clean-up)
* ``tess-clean``   Tesseract on the cleaned page (:mod:`kenning_nlp.straighten`)
* ``rapid-raw``    RapidOCR (bundled PP-OCRv6 small models) on the image as uploaded
* ``rapid-clean``  RapidOCR on the cleaned page
* ``rapid5-clean`` RapidOCR with the PP-OCRv5 Latin recognition model (downloaded once)

Reported per variant and image kind (scan, photo, curl): WER (word edit distance / words in
the transcription), CER (the same over characters), bag-of-words error (WER ignoring word
order, so a different reading order of columns does not count) and seconds per page. Texts are
compared after Unicode NFC, straight quotes and dashes, and dropped answer lines (``____``)
and bullets. Recognised texts are written to ``DATA/out/<variant>/`` for inspection.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import unicodedata
from collections import Counter
from collections.abc import Callable, Sequence
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

KINDS = ("scan", "photo", "curl")


# --------------------------------------------------------------------------- metrics


def normalize(text: str) -> list[str]:
    """Text -> comparable tokens (see the module docstring)."""
    t = unicodedata.normalize("NFC", text)
    for a, b in (("‘’‚‛´`", "'"), ("“”„", '"'), ("–—‐‑", "-")):
        for ch in a:
            t = t.replace(ch, b)
    t = t.replace("…", "...")
    t = re.sub(r"_+", " ", t)
    t = re.sub(r"[•·▪■●]", " ", t)
    t = re.sub(r"\s*/\s*", " / ", t)
    return t.split()


def _edit(a: Sequence[str] | str, b: Sequence[str] | str) -> int:
    try:
        from rapidfuzz.distance import Levenshtein

        return int(Levenshtein.distance(a, b))
    except ImportError:
        prev = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            cur = [i] + [0] * len(b)
            for j, cb in enumerate(b, 1):
                cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            prev = cur
        return prev[-1]


def scores(ref: str, hyp: str) -> tuple[float, float, float]:
    """(WER, CER, bag-of-words error) of ``hyp`` against ``ref``."""
    r, h = normalize(ref), normalize(hyp)
    wer = _edit(r, h) / max(1, len(r))
    rc, hc = " ".join(r), " ".join(h)
    cer = _edit(rc, hc) / max(1, len(rc))
    common = sum((Counter(r) & Counter(h)).values())
    bag = (max(len(r), len(h)) - common) / max(1, len(r))
    return wer, cer, bag


# --------------------------------------------------------------------------- photo-like pages


def _place(page, rng, tilt: float):  # noqa: ANN001, ANN202 (numpy arrays)
    """The page on a darker table, seen at an angle, under uneven light, slightly blurred."""
    import cv2
    import numpy as np

    page = cv2.resize(page, None, fx=0.8, fy=0.8, interpolation=cv2.INTER_AREA)
    ph, pw = page.shape[:2]
    ch, cw = int(ph * 1.4), int(pw * 1.4)
    base = np.array([[0.13, 0.1], [0.87, 0.1], [0.87, 0.9], [0.13, 0.9]]) * [cw, ch]
    jitter = rng.uniform(-tilt, tilt, size=(4, 2)) * [cw, ch]
    dst = (base + jitter).astype(np.float32)
    src = np.array([[0, 0], [pw, 0], [pw, ph], [0, ph]], np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    table = np.full((ch, cw, 3), (80, 95, 112), np.uint8)
    table = cv2.add(
        table, rng.normal(0, 12, table.shape).astype(np.int16).clip(0, 255).astype(np.uint8)
    )
    out = cv2.warpPerspective(page, m, (cw, ch), dst=table, borderMode=cv2.BORDER_TRANSPARENT)
    yy, xx = np.mgrid[0:ch, 0:cw].astype(np.float32)
    gx, gy = rng.uniform(-0.25, 0.25, 2)
    light = 0.82 + gx * (xx / cw - 0.5) + gy * (yy / ch - 0.5)
    cx, cy = rng.uniform(0.2, 0.8, 2)
    light -= 0.18 * np.exp(-(((xx / cw - cx) ** 2 + (yy / ch - cy) ** 2) / 0.05))
    out = (out.astype(np.float32) * light[..., None]).clip(0, 255)
    out = cv2.GaussianBlur(out, (0, 0), 1.2)
    out = (out + rng.normal(0, 3, out.shape)).clip(0, 255).astype(np.uint8)
    return out


def _curl(page, right_spine: bool):  # noqa: ANN001, ANN202
    """Bend the lines towards the spine like a book page that does not lie flat."""
    import cv2
    import numpy as np

    h, w = page.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = xx / w if right_spine else 1 - xx / w
    dy = 0.025 * h * t**2.5 * ((yy - h / 2) / (h / 2)) + 0.012 * h * t**2
    dx = 0.05 * w * t**3 * (1 if right_spine else -1)
    out = cv2.remap(page, xx + dx, yy - dy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    shade = 1 - 0.35 * t**4
    return (out.astype(np.float32) * shade[..., None]).clip(0, 255).astype(np.uint8)


def make_photos(pages: Path, photos: Path) -> None:
    import zlib

    import numpy as np

    photos.mkdir(parents=True, exist_ok=True)
    for f in sorted(pages.glob("*.png")):
        rng = np.random.default_rng(zlib.crc32(f.stem.encode()))
        page = np.asarray(Image.open(f).convert("RGB"))
        for kind in ("photo", "curl"):
            target = photos / f"{f.stem}-{kind}.jpg"
            if target.exists():
                continue
            src = _curl(page, right_spine=bool(rng.integers(2))) if kind == "curl" else page
            img = _place(src, rng, tilt=0.05 if kind == "photo" else 0.03)
            Image.fromarray(img).save(target, quality=82)
            print("made", target.name, flush=True)


# --------------------------------------------------------------------------- variants


def _rapid5() -> None:
    """Swap this thread's RapidOCR engine for one with the PP-OCRv5 Latin recognition model."""
    from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR

    from kenning_nlp import rapid

    if getattr(rapid._local, "v5", False):
        return
    rapid._local.engine = RapidOCR(
        params={
            "Global.log_level": "warning",
            "Global.return_word_box": True,
            "Global.max_side_len": rapid.MAX_SIDE,
            "Rec.lang_type": LangRec.LATIN,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
            "Rec.model_type": ModelType.MOBILE,
        }
    )
    rapid._local.v5 = True


def variant(name: str) -> Callable[[Image.Image], str]:
    from kenning_nlp.ocr import recognize, words_to_text

    engine, mode = name.rsplit("-", 1)
    clean = mode == "clean"
    code = {"tess": "nld", "rapid": "rapidocr-nl", "rapid5": "rapidocr-nl"}[engine]

    def run(img: Image.Image) -> str:
        if engine == "rapid5":
            _rapid5()
        return words_to_text(recognize(img, code, clean=clean).data)[0]

    return run


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("data", type=Path)
    ap.add_argument("--variants", default="tess-raw,tess-clean,rapid-raw,rapid-clean")
    ap.add_argument("--kinds", default=",".join(KINDS))
    ap.add_argument("--per-page", action="store_true")
    ap.add_argument("--threads", type=int, help="CPU threads per engine (default: all)")
    ap.add_argument("--rapid-max-side", type=int, help="RapidOCR's long-side limit (pixels)")
    args = ap.parse_args()
    if args.rapid_max_side:
        from kenning_nlp import rapid

        rapid.MAX_SIDE = args.rapid_max_side
    if args.threads:
        os.environ["OMP_THREAD_LIMIT"] = str(args.threads)
        os.environ["KENNING_OCR_THREADS"] = str(args.threads)

    pages, gt = args.data / "pages", args.data / "gt"
    make_photos(pages, args.data / "photos")
    names = sorted(p.stem for p in gt.glob("*.txt") if (pages / f"{p.stem}.png").exists())
    kinds = args.kinds.split(",")
    rows: list[tuple[str, str, str, float, float, float, float]] = []
    for vname in args.variants.split(","):
        run = variant(vname)
        run(Image.new("RGB", (200, 100), "white"))  # load models outside the timing
        suffix = f"-{args.rapid_max_side}" if args.rapid_max_side and "rapid" in vname else ""
        out_dir = args.data / "out" / (vname + suffix)
        out_dir.mkdir(parents=True, exist_ok=True)
        for kind in kinds:
            for name in names:
                path = (
                    pages / f"{name}.png"
                    if kind == "scan"
                    else args.data / "photos" / f"{name}-{kind}.jpg"
                )
                img = Image.open(path)
                img.load()
                t0 = time.perf_counter()
                text = run(img)
                secs = time.perf_counter() - t0
                (out_dir / f"{name}-{kind}.txt").write_text(text, "utf-8")
                wer, cer, bag = scores((gt / f"{name}.txt").read_text("utf-8"), text)
                rows.append((vname, kind, name, wer, cer, bag, secs))
                print(
                    f"{vname:13} {kind:5} {name:8} WER {wer:6.1%} CER {cer:6.1%} "
                    f"bag {bag:6.1%} {secs:5.1f}s",
                    flush=True,
                )

    print("\n| variant | images | WER | CER | bag-of-words | s/page |")
    print("| --- | --- | ---: | ---: | ---: | ---: |")
    for vname in args.variants.split(","):
        for kind in kinds:
            sel = [r for r in rows if r[0] == vname and r[1] == kind]
            if not sel:
                continue
            n = len(sel)
            mean = [sum(r[i] for r in sel) / n for i in (3, 4, 5, 6)]
            print(
                f"| {vname} | {kind} | {mean[0]:.1%} | {mean[1]:.1%} | {mean[2]:.1%} "
                f"| {mean[3]:.1f} |"
            )
    if args.per_page:
        print("\n| variant | image | WER | CER | bag-of-words | s |")
        print("| --- | --- | ---: | ---: | ---: | ---: |")
        for r in rows:
            print(f"| {r[0]} | {r[2]}-{r[1]} | {r[3]:.1%} | {r[4]:.1%} | {r[5]:.1%} | {r[6]:.1f} |")


if __name__ == "__main__":
    main()
