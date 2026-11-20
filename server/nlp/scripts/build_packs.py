"""Build the data pack archives and record their digests in ``src/vuurtoren_nlp/packs.json``.

Usage (from server/nlp)::

    uv run python scripts/build_packs.py --out dist/packs                 # build everything
    uv run python scripts/build_packs.py --out dist/packs --from-data data  # pack existing files
    uv run python scripts/build_packs.py --out dist/packs --download URL    # fetch + verify
    uv run python scripts/build_packs.py --grammar-from dist/packs          # grammar cache only
    uv run python scripts/build_packs.py --out dist/packs --audio-from DIR  # audio pack only

Each downloadable pack becomes ``<name>-<version>.tar.gz`` (deterministic: sorted, mtime 0,
root-owned, so the same data gives the same SHA-256). Versions come from packs.json: bump a
pack's version when its data changes (new upstream snapshot, schema change), rebuild, upload the
archives as release assets (``gh release upload packs-<version> dist/packs/*``) and commit the
updated packs.json. Servers then install the new version at their next start (or via
``POST /admin/packs``). See docs/architecture.md, "Data packs".

Next to them goes the grammar-example cache, ``grammar-examples-nl-<sentences version>-<detector
hash>.tar.gz`` (not in packs.json: it is derived from the sentence pack and the grammar detectors).
The offline installer and the ``-full`` image bundle it, so their first start does not build it;
``--grammar-from DIR`` makes it from the sentence pack archive in DIR (the offline installer's
build, whose archives come from the release).

``--audio-from DIR`` packs the spoken starter words and sentences (``DIR/{female,male}/<id>.mp3``,
made by ``scripts/tts_elevenlabs.py``) as ``audio-nl-<version>.tar.gz`` and lists it in packs.json
(version: ``--audio-version``, by default the dictionary's, so it goes in the same release).
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "src" / "vuurtoren_nlp" / "packs.json"
# pack name -> data file/dir name inside the data directory
TARGETS = {
    "dictionary-nl": "dictionary-nl.sqlite",
    "sentences-nl": "sentences-nl.sqlite",
    "mt-nl-en": "mt-nl-en",
}


def _info(name: str, size: int, is_dir: bool) -> tarfile.TarInfo:
    ti = tarfile.TarInfo(name)
    ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = 0, 0, 0, "", ""
    if is_dir:
        ti.type, ti.mode = tarfile.DIRTYPE, 0o755
    else:
        ti.size, ti.mode = size, 0o644
    return ti


def make_archive(src: Path, dest: Path, root: str | None = None) -> None:
    """Deterministic tar.gz of ``src`` (a file or a directory) under ``root`` (default its name)."""
    paths = [src] if src.is_file() else [src, *sorted(src.rglob("*"))]
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for p in paths:
            arc = str(Path(root or src.name) / p.relative_to(src))
            if p.is_dir():
                tar.addfile(_info(arc, 0, True))
            else:
                with p.open("rb") as fh:
                    tar.addfile(_info(arc, p.stat().st_size, False), fh)
    with dest.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as gz:
        gz.write(buf.getvalue())


def build(name: str, data: Path) -> None:
    """Run the pack's build script into ``data`` (dictionary first: the others read it)."""
    py = [sys.executable]
    env = {**os.environ, "VUURTOREN_DATA_DIR": str(data)}
    cmd = {
        "dictionary-nl": ["scripts/build_dictionary.py", "--output", str(data / TARGETS[name])],
        "sentences-nl": [
            "scripts/build_sentences.py",
            *("--processes", "4", "--download-dir", str(data / "tatoeba")),
            *("--output", str(data / TARGETS[name])),
        ],
        "mt-nl-en": ["scripts/fetch_mt_model.py", "--output", str(data / TARGETS[name])],
    }[name]
    subprocess.run(py + cmd, check=True, cwd=ROOT, env=env)


def build_grammar(sentences: Path, out: Path) -> Path:
    """Build the grammar-example cache from a sentence DB and archive it into ``out``."""
    from vuurtoren_nlp.packs import grammar_archive_name

    with tempfile.TemporaryDirectory() as d:
        cache = Path(d) / "grammar-examples-nl.sqlite"
        env = {
            **os.environ,
            "VUURTOREN_SENTENCES_PATH": str(sentences),
            "VUURTOREN_GRAMMAR_CACHE_PATH": str(cache),
        }
        subprocess.run(
            [sys.executable, "scripts/build_grammar_examples.py"], check=True, cwd=ROOT, env=env
        )
        dest = out / grammar_archive_name()
        make_archive(cache, dest)
    print(f"{dest.name}: {dest.stat().st_size / 1e6:.1f} MB")
    return dest


def grammar_from(manifest: dict, packs_dir: Path) -> int:
    """Build the grammar archive from the (verified) sentence pack archive in ``packs_dir``."""
    entry = manifest["packs"]["sentences-nl"]
    archive = packs_dir / f"sentences-nl-{entry['version']}.tar.gz"
    if hashlib.sha256(archive.read_bytes()).hexdigest() != entry["sha256"]:
        print(f"{archive.name}: checksum mismatch", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory() as d, tarfile.open(archive) as tar:
        tar.extractall(d, filter="data")
        build_grammar(Path(d) / TARGETS["sentences-nl"], packs_dir)
    return 0


AUDIO_VOICES = ("female", "male")


def audio_from(manifest: dict, src: Path, out: Path, version: str | None) -> int:
    """Pack ``src/{female,male}/*.mp3`` as the ``audio-nl`` archive and record it in packs.json."""
    voices = [v for v in AUDIO_VOICES if (src / v).is_dir()]
    if not voices:
        print(f"{src}: no female/ or male/ folder", file=sys.stderr)
        return 1
    files = [p for p in src.rglob("*") if p.is_file()]
    stray = [p for p in files if p.suffix != ".mp3" or p.parent.parent != src]
    if stray or any(p.parent.name not in voices for p in files):
        print(f"{src}: not a clip: {(stray or files)[0]}", file=sys.stderr)
        return 1
    version = version or manifest["packs"]["dictionary-nl"]["version"]
    dest = out / f"audio-nl-{version}.tar.gz"
    make_archive(src, dest, root="audio-nl")
    manifest["packs"]["audio-nl"] = {
        "version": version,
        "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
        "size": dest.stat().st_size,
    }
    print(f"{dest.name}: {len(files)} clips, {dest.stat().st_size / 1e6:.1f} MB")
    return 0


def download(manifest: dict, url: str, out: Path, names: list[str]) -> int:
    """Fetch ``<url>/<name>-<version>.tar.gz`` for each pack and verify it against packs.json."""
    for name in names:
        entry = manifest["packs"][name]
        file = f"{name}-{entry['version']}.tar.gz"
        dest = out / file
        req = urllib.request.Request(
            f"{url.rstrip('/')}/{file}", headers={"User-Agent": "vuurtoren"}
        )
        with urllib.request.urlopen(req, timeout=60) as resp, dest.open("wb") as fh:  # noqa: S310
            while chunk := resp.read(1 << 20):
                fh.write(chunk)
        sha = hashlib.sha256(dest.read_bytes()).hexdigest()
        if sha != entry["sha256"] or dest.stat().st_size != entry["size"]:
            dest.unlink()
            print(f"{file}: checksum mismatch (got {sha})", file=sys.stderr)
            return 1
        print(f"{file}: ok")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--out", type=Path, help="directory for the archives")
    ap.add_argument("--from-data", type=Path, help="pack these existing files instead of building")
    ap.add_argument("--download", metavar="URL", help="fetch the published archives instead")
    ap.add_argument("--only", nargs="*", choices=sorted(TARGETS), help="just these packs")
    ap.add_argument(
        "--grammar-from", type=Path, metavar="DIR", help="only the grammar cache, from DIR"
    )
    ap.add_argument(
        "--audio-from", type=Path, metavar="DIR", help="only the audio pack, from DIR/{female,male}"
    )
    ap.add_argument("--audio-version", help="audio pack version (default: the dictionary's)")
    args = ap.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    if args.grammar_from:
        return grammar_from(manifest, args.grammar_from)
    if args.out is None:
        ap.error("--out is required")
    args.out.mkdir(parents=True, exist_ok=True)
    if args.audio_from:
        code = audio_from(manifest, args.audio_from.expanduser(), args.out, args.audio_version)
        if code == 0:
            MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n")
            print(f"Updated {MANIFEST.relative_to(ROOT)}")
        return code
    if args.download:
        return download(manifest, args.download, args.out, args.only or list(TARGETS))
    with tempfile.TemporaryDirectory() as d:
        data = args.from_data or Path(d)
        for name in args.only or list(TARGETS):
            entry = manifest["packs"][name]
            if args.from_data is None:
                build(name, data)
            src = data / TARGETS[name]
            dest = args.out / f"{name}-{entry['version']}.tar.gz"
            make_archive(src, dest)
            entry["sha256"] = hashlib.sha256(dest.read_bytes()).hexdigest()
            entry["size"] = dest.stat().st_size
            print(f"{dest.name}: {entry['size'] / 1e6:.1f} MB  sha256 {entry['sha256'][:16]}...")
        if "sentences-nl" in (args.only or TARGETS):
            build_grammar(data / TARGETS["sentences-nl"], args.out)
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"Updated {MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
