"""Download the offline Dutch -> English translation model into ``data/mt-nl-en/``.

Usage (from server/nlp; standard library only, so it also runs in a bare Docker stage)::

    uv run python scripts/fetch_mt_model.py
    python scripts/fetch_mt_model.py --output /out/mt-nl-en

The model is Helsinki-NLP's OPUS-MT ``opus-mt-nl-en`` (Apache-2.0 on its Hugging Face card; the
OPUS-MT training data/recipes are CC BY 4.0, see DATA_LICENSES.md) converted to the CTranslate2
format. It is fetched from the community conversion ``gaudi/opus-mt-nl-en-ctranslate2`` at a
pinned commit, and the large files are verified against pinned SHA-256 digests. About 160 MB.

To convert from the official weights yourself instead (needs torch, only once)::

    uv run --with torch --with transformers ct2-transformers-converter \\
        --model Helsinki-NLP/opus-mt-nl-en --output_dir data/mt-nl-en --quantization int8 \\
        --copy_files source.spm target.spm
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

REPO = "gaudi/opus-mt-nl-en-ctranslate2"
REVISION = "b3cf3a61c0c3a7e2628813dfb0f2049046045aa1"
BASE_URL = f"https://huggingface.co/{REPO}/resolve/{REVISION}"
# file name -> expected SHA-256 (None: small text file, not pinned by an LFS digest)
FILES: dict[str, str | None] = {
    "config.json": None,
    "shared_vocabulary.json": None,
    "source.spm": "f538d23d4b30641cd97c608d2a83890d503aa1286a5560f19ef949404a786e94",
    "target.spm": "d05781fde84b8793191528a7a176e1b17f96265388f602379ee6ae3139f59141",
    "model.bin": "a07b5103b41acba9c3ae718f75c2f6031d9f497075bcd903c1015ceaede2e8de",
}
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "mt-nl-en"


def fetch(name: str, sha256: str | None, out_dir: Path) -> None:
    """Download one file to ``out_dir`` (via a .part file) and verify its digest if pinned."""
    dest = out_dir / name
    req = urllib.request.Request(f"{BASE_URL}/{name}", headers={"User-Agent": "kenning-fetch-mt"})
    digest = hashlib.sha256()
    part = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(req, timeout=60) as resp, part.open("wb") as fh:  # noqa: S310
        while chunk := resp.read(1 << 20):
            digest.update(chunk)
            fh.write(chunk)
    if sha256 and digest.hexdigest() != sha256:
        part.unlink()
        raise SystemExit(f"Checksum mismatch for {name}: got {digest.hexdigest()}")
    part.replace(dest)
    print(f"  {name}: {dest.stat().st_size / 1e6:.1f} MB")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="model directory")
    ap.add_argument("--force", action="store_true", help="re-download existing files")
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    print(f"Fetching {REPO}@{REVISION[:8]} into {args.output}")
    for name, sha in FILES.items():
        if (args.output / name).exists() and not args.force:
            print(f"  {name}: already present")
            continue
        fetch(name, sha, args.output)
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
