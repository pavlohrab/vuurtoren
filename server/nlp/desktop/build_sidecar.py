"""Build the desktop sidecar: `vuurtoren_nlp` + Python as a PyInstaller one-directory bundle.

    uv run --no-project python server/nlp/desktop/build_sidecar.py [--out DIR] [--packs]

Steps: a fresh build venv from uv.lock (no dev tools), trimmed like the slim Docker image
(Dutch-only simplemma, the wordfreq lists /detect needs, no tests), then PyInstaller with
vuurtoren-nlp.spec. The result goes to ``apps/desktop/src-tauri/sidecar/vuurtoren-nlp/`` (bundled as
a Tauri resource by ``tauri.sidecar.conf.json``). OCR is included: RapidOCR with its bundled
PaddleOCR models (the ``ocr`` extra), so photo and scan import work offline from the first start
and ``/health`` reports ``"ocr": true``.

``--packs DIR`` also copies the data pack archives (``<name>-<version>.tar.gz`` for every pack in
``packs.json``) to ``sidecar/packs/`` for the offline installer (``tauri.packs.conf.json``).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NLP = HERE.parent
REPO = NLP.parents[1]
DEFAULT_OUT = REPO / "apps" / "desktop" / "src-tauri" / "sidecar"
PYTHON = "3.12"
PYINSTALLER = "pyinstaller==6.22.3"
WORDFREQ_KEEP = re.compile(r"(large_nl|small_(nl|en|de|fr|es|it|pt|pl|uk|ru))\.msgpack\.gz$")


def run(cmd: list[str], **kw: object) -> None:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, **kw)  # type: ignore[call-overload]


def site_packages(venv: Path) -> Path:
    if os.name == "nt":
        return venv / "Lib" / "site-packages"
    return next((venv / "lib").glob("python3*/site-packages"))


def trim(sp: Path) -> None:
    """What the service never loads (same list as server/nlp/Dockerfile)."""
    for f in (sp / "simplemma" / "strategies" / "dictionaries" / "data").glob("*"):
        if f.is_file() and f.name != "nl.plzma":
            f.unlink()
    for f in (sp / "wordfreq" / "data").glob("*"):
        if f.is_file() and not WORDFREQ_KEEP.search(f.name):
            f.unlink()
    for d in sorted(sp.rglob("*"), reverse=True):
        if d.is_dir() and d.name in ("tests", "__pycache__"):
            shutil.rmtree(d, ignore_errors=True)
    for name in ("setuptools", "pkg_resources", "_distutils_hack"):
        shutil.rmtree(sp / name, ignore_errors=True)
    (sp / "distutils-precedence.pth").unlink(missing_ok=True)


def dir_size(path: Path) -> int:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def copy_packs(src: Path, out: Path) -> None:
    manifest = json.loads((NLP / "src" / "vuurtoren_nlp" / "packs.json").read_text())["packs"]
    dest = out / "packs"
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    for name, entry in manifest.items():
        file = f"{name}-{entry['version']}.tar.gz"
        if not (src / file).is_file():
            sys.exit(f"missing pack archive {src / file}")
        shutil.copyfile(src / file, dest / file)
    print(f"packs: {dir_size(dest) / 1e6:.0f} MB in {dest}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--packs", type=Path, help="directory with the pack archives to bundle")
    ap.add_argument("--keep-venv", action="store_true", help="reuse the build venv")
    args = ap.parse_args()

    build = NLP / "build"
    venv = build / "sidecar-venv"
    if not args.keep_venv:
        shutil.rmtree(venv, ignore_errors=True)
    env = {**os.environ, "UV_PROJECT_ENVIRONMENT": str(venv), "UV_LINK_MODE": "copy"}
    run(
        ["uv", "sync", "--locked", "--no-dev", "--no-editable", "--extra", "ocr"]
        + ["--python", PYTHON],
        cwd=NLP,
        env=env,
    )
    py = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    run(["uv", "pip", "install", "--python", str(py), PYINSTALLER], cwd=NLP, env=env)
    trim(site_packages(venv))

    target = args.out / "vuurtoren-nlp"
    shutil.rmtree(target, ignore_errors=True)
    run(
        [
            str(py),
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--log-level",
            "WARN",
            "--distpath",
            str(args.out),
            "--workpath",
            str(build / "pyinstaller"),
            str(HERE / "vuurtoren-nlp.spec"),
        ],
        cwd=HERE,
        env=env,
    )
    print(f"sidecar: {dir_size(target) / 1e6:.0f} MB in {target}")
    if args.packs:
        copy_packs(args.packs, args.out)


if __name__ == "__main__":
    main()
