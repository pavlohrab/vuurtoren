"""Download SyntaxDot (the sentence structure's parser) into the folder the server reads it from.

The same steps as ``scripts/get_syntaxdot.py``, run by the server in the background so a Linux
computer can get it from Settings (SX4): the CPU binary (v0.5.0, with libtorch) and the distilled
Dutch model, about 250 MB to download, 620 MB unpacked, into
:func:`vuurtoren_nlp.syntax.syntaxdot_target` as ``bin/`` and ``nl/``. Linux on x86_64 only.
The binary's archive is zstd: it needs the ``zstd`` command (on most Linux systems already).
"""

from __future__ import annotations

import shutil
import subprocess
import tarfile
import tempfile
import threading
import urllib.request
from pathlib import Path

from vuurtoren_nlp.syntax import supported, syntaxdot_dir, syntaxdot_target

BINARY = (
    "https://github.com/tensordot/syntaxdot/releases/download/v0.5.0/"
    "syntaxdot-v0.5.0-cpu-x86_64-linux-gnu-gcc.tar.zst"
)
MODEL = (
    "https://github.com/tensordot/syntaxdot-models/releases/download/"
    "nl-l6-h384-20210728/nl-l6-h384-20210728.tar.gz"
)

_lock = threading.Lock()
_state: dict[str, object] = {"state": "idle", "step": "", "received": 0, "error": None}


def _fetch(url: str, dest: Path) -> None:
    with urllib.request.urlopen(url, timeout=60) as res, dest.open("wb") as out:
        while chunk := res.read(1 << 20):
            out.write(chunk)
            with _lock:
                _state["received"] = int(_state["received"]) + len(chunk)  # type: ignore[arg-type]


def install(target: Path) -> None:
    """Download and unpack SyntaxDot into ``target`` (replaces an older copy)."""
    if shutil.which("zstd") is None:
        raise RuntimeError(
            "Needs the zstd command. Install it first (sudo dnf install zstd, or sudo apt "
            "install zstd), then try again."
        )
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target) as tmp:
        t = Path(tmp)
        _step("the program")
        _fetch(BINARY, t / "bin.tar.zst")
        subprocess.run(
            ["zstd", "-q", "-d", str(t / "bin.tar.zst"), "-o", str(t / "bin.tar")], check=True
        )
        with tarfile.open(t / "bin.tar") as tar:
            tar.extractall(t / "bin", filter="data")
        _step("the Dutch model")
        _fetch(MODEL, t / "nl.tar.gz")
        with tarfile.open(t / "nl.tar.gz") as tar:
            tar.extractall(t / "nl", filter="data")
        for name in ("bin", "nl"):
            inner = [p for p in (t / name).iterdir() if p.is_dir()]
            src = inner[0] if len(inner) == 1 else t / name
            if (target / name).exists():
                shutil.rmtree(target / name)
            shutil.move(str(src), str(target / name))
    (target / "bin" / "syntaxdot").chmod(0o755)


def _step(what: str) -> None:
    with _lock:
        _state["step"] = what


def _run() -> None:
    try:
        install(syntaxdot_target())
        with _lock:
            _state.update(state="done", step="", error=None)
    except Exception as e:  # noqa: BLE001 - said back to the page as it is
        with _lock:
            _state.update(state="failed", step="", error=str(e))


def start() -> bool:
    """Start the download in the background; False if it runs already or can't run here."""
    if not supported() or syntaxdot_dir() is not None:
        return False
    with _lock:
        if _state["state"] == "downloading":
            return False
        _state.update(state="downloading", step="", received=0, error=None)
    threading.Thread(target=_run, name="syntaxdot-download", daemon=True).start()
    return True


def status() -> dict[str, object]:
    """Whether it can run here, whether it's in, and how a download goes."""
    with _lock:
        now = dict(_state)
    return {"supported": supported(), "installed": syntaxdot_dir() is not None, **now}
