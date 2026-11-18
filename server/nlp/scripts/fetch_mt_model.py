"""Build the offline Dutch -> English translation model (data pack ``mt-nl-en``).

Usage (from server/nlp)::

    uv run python scripts/fetch_mt_model.py                    # into data/mt-nl-en/
    python scripts/fetch_mt_model.py --output /out/mt-nl-en    # (needs ctranslate2 + pyyaml)

The model is Helsinki-NLP's OPUS-MT ``opus-mt-nl-en`` (opus-2019-12-05; Apache-2.0 / CC BY 4.0,
see DATA_LICENSES.md). The original Marian release (~290 MB zip, pinned SHA-256) is downloaded
and converted with CTranslate2's OPUS-MT converter to **int8 weights on disk** (~85 MB, half the
float32 conversion we shipped before; the service already ran it as int8, see
docs/research/10-nlp-footprint.md for the comparison). The zip is deleted afterwards.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pinned_download import PinMismatchError, download_verified  # noqa: E402

URL = "https://object.pouta.csc.fi/OPUS-MT-models/nl-en/opus-2019-12-05.zip"
SHA256 = "47c0c30cfaa2030b8b676ce0d01c013208539bd87960a5166154356fa718f64b"
SIZE = 291_933_433
KEEP = ("decoder.yml", "source.spm", "target.spm")
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "mt-nl-en"


def convert(src: Path, out: Path) -> None:
    """OPUS-MT (Marian npz) -> CTranslate2 int8, plus the SentencePiece models."""
    from ctranslate2.converters import OpusMTConverter

    tmp = out.with_name(out.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    OpusMTConverter(str(src)).convert(str(tmp), quantization="int8", force=True)
    for name in ("source.spm", "target.spm"):
        shutil.copyfile(src / name, tmp / name)
    shutil.rmtree(out, ignore_errors=True)
    tmp.replace(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="model directory")
    ap.add_argument("--zip", type=Path, help="use this local copy of the OPUS-MT zip")
    args = ap.parse_args()
    with tempfile.TemporaryDirectory(
        dir=args.output.parent if args.output.parent.exists() else None
    ) as d:
        tmp = Path(d)
        archive = args.zip
        if archive is None:
            archive = tmp / "opus.zip"
            try:
                download_verified(URL, archive, "OPUS-MT nl-en", SHA256, SIZE, False, "kenning-mt")
            except PinMismatchError as e:
                print(e, file=sys.stderr)
                return 1
        src = tmp / "src"
        with zipfile.ZipFile(archive) as z:
            names = z.namelist()
            model = next(n for n in names if n.endswith(".npz"))
            vocab = next(n for n in names if n.endswith(".vocab.yml"))
            for n in (*KEEP, model, vocab):
                z.extract(n, src)
        if archive.parent == tmp:
            archive.unlink()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        convert(src, args.output)
    size = sum(f.stat().st_size for f in args.output.iterdir())
    print(f"Model written to {args.output} ({size / 1e6:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
