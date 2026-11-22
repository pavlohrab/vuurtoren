"""Data packs: the dictionary, the sentence DB, the MT model, the grammar-example cache, audio.

The data is not part of the image. Each pack has a version in ``packs.json`` (next to this
file: version, SHA-256 and size of its ``<name>-<version>.tar.gz`` archive). The installed state
of a pack is a marker next to its data (``dictionary-nl.sqlite.pack.json``). A pack is

* ``ok``          installed at the wanted version;
* ``outdated``    installed at another version (still used until the new one is in place);
* ``unversioned`` present without a marker (a development build or your own file: used as is,
                  never replaced automatically; ``POST /admin/packs?force=true`` replaces it);
* ``missing``.

``ensure()`` installs missing and outdated packs, one at a time, from the first source that has
them:

1. ``$VUURTOREN_PACKS_DIR``: a directory of pack archives (the "all-in" image and the desktop
   sidecar bundle them; works offline);
2. ``$VUURTOREN_PACKS_URL``: ``<url>/<name>-<version>.tar.gz`` (the data host, data.vuurtoren.app, or any static
   host; ``$VUURTOREN_PACKS_TOKEN`` is sent as a bearer token when set);
3. a local build with ``scripts/`` (downloads the pinned upstream sources: Kaikki, Tatoeba,
   OPUS-MT; ~10 minutes). Only in ``VUURTOREN_PACKS=auto`` mode.

Archives are verified (size + SHA-256) before anything is replaced, extracted next to the target
and swapped in with a rename, so a failed or interrupted update leaves the old data in use. The
grammar-example cache is *derived*: it is tied to the grammar detectors' code and the sentence pack,
so it is never downloaded. A bundled ``grammar-examples-nl-<sentences version>-<detectors>.tar.gz``
in ``$VUURTOREN_PACKS_DIR`` (the offline installer and the ``-full`` image; made by
``scripts/build_packs.py``) is unpacked when it fits the installed sentences and the current
detectors; otherwise the cache is built here from the sentence pack (a few minutes).

The audio pack (``audio-nl``, spoken starter words and sentences) is optional: ``packs.json``
lists it only once its archive is published; until then it is skipped (the app uses the system
voice).

``VUURTOREN_PACKS`` = ``off`` (default outside Docker: nothing runs by itself), ``download``
(sources 1-2 only) or ``auto`` (1-3; the Docker image's default). The server runs ``ensure()``
in a background thread at startup; ``GET /health`` shows the state, ``POST /admin/packs`` runs
it again.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from vuurtoren_nlp.audio import audio_dir
from vuurtoren_nlp.dictionary import default_db_path as dictionary_path
from vuurtoren_nlp.grammar_examples import default_cache_path as grammar_cache_path
from vuurtoren_nlp.sentences import default_db_path as sentences_path
from vuurtoren_nlp.translate import model_dir

log = logging.getLogger(__name__)

MANIFEST_PATH = Path(__file__).with_name("packs.json")
SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
CHUNK = 1 << 20
GRAMMAR_SCAN_MAX = 40_000

Mode = Literal["off", "download", "auto"]


@dataclass(frozen=True)
class PackSpec:
    name: str
    target: Callable[[], Path]
    kind: Literal["file", "dir"]
    build: Callable[[Path], list[str]] | None = None
    """argv that builds the pack's data at the given output path (None: not buildable)."""
    derived: bool = False


def _py(script: str, *args: str) -> list[str]:
    return [sys.executable, str(SCRIPTS_DIR / script), *args]


SPECS: dict[str, PackSpec] = {
    s.name: s
    for s in (
        PackSpec(
            "dictionary-nl",
            dictionary_path,
            "file",
            lambda out: _py("build_dictionary.py", "--output", str(out)),
        ),
        PackSpec(
            "sentences-nl",
            sentences_path,
            "file",
            lambda out: _py(
                "build_sentences.py",
                "--processes",
                str(min(4, os.cpu_count() or 1)),
                "--download-dir",
                str(out.parent / "tatoeba-download"),
                "--output",
                str(out),
            ),
        ),
        PackSpec(
            "mt-nl-en", model_dir, "dir", lambda out: _py("fetch_mt_model.py", "--output", str(out))
        ),
        PackSpec("grammar-examples-nl", grammar_cache_path, "file", derived=True),
        # Optional: in packs.json only once published (scripts/build_packs.py --audio-from).
        PackSpec("audio-nl", audio_dir, "dir"),
    )
}


def manifest() -> dict[str, dict[str, Any]]:
    """``{name: {version, sha256, size}}`` for the downloadable packs."""
    return json.loads(MANIFEST_PATH.read_text())["packs"]


def mode() -> Mode:
    raw = os.environ.get("VUURTOREN_PACKS", "off").strip().lower()
    return raw if raw in ("off", "download", "auto") else "off"  # type: ignore[return-value]


def marker_path(target: Path) -> Path:
    return target.with_name(target.name + ".pack.json")


def archive_name(name: str, version: str) -> str:
    return f"{name}-{version}.tar.gz"


PHONE_PACKS = ("dictionary-nl",)
"""Packs the Android app keeps on the phone; this server hands their archives on (``GET
/packs/<archive>``, behind the sign-in, so a paired phone fetches them with its sync token)."""


def _kept_archive(name: str, version: str) -> Path:
    """Where the verified archive of a phone pack is kept after it was installed here."""
    return SPECS[name].target().parent / ".archives" / archive_name(name, version)


def phone_archive(file: str) -> Path | None:
    """The archive of a phone pack at the manifest version, if this server has it.

    From ``$VUURTOREN_PACKS_DIR`` (bundled) or the copy kept when the pack was installed here;
    only when its size matches the manifest (the phone checks the SHA-256 itself).
    """
    entries = manifest()
    for name in PHONE_PACKS:
        entry = entries.get(name)
        if not entry or file != archive_name(name, entry["version"]):
            continue
        local = os.environ.get("VUURTOREN_PACKS_DIR")
        for path in (Path(local) / file if local else None, _kept_archive(name, entry["version"])):
            if path is not None and path.is_file() and path.stat().st_size == int(entry["size"]):
                return path
    return None


def _keep_archive(name: str, version: str, archive: Path) -> None:
    """Keep a phone pack's verified archive (and drop older ones) so phones can fetch it here."""
    kept = _kept_archive(name, version)
    kept.parent.mkdir(parents=True, exist_ok=True)
    for old in kept.parent.glob(f"{name}-*.tar.gz"):
        if old != kept:
            old.unlink(missing_ok=True)
    tmp = kept.with_suffix(".part")
    shutil.copyfile(archive, tmp)
    os.replace(tmp, kept)


def installed(name: str) -> dict[str, Any] | None:
    """The marker of an installed pack, or None."""
    try:
        return json.loads(marker_path(SPECS[name].target()).read_text())
    except (OSError, ValueError):
        return None


def _present(spec: PackSpec) -> bool:
    target = spec.target()
    return target.is_dir() if spec.kind == "dir" else target.is_file()


def _grammar_state() -> str:
    from vuurtoren_nlp.grammar_examples import GrammarExamples

    if not grammar_cache_path().is_file():
        return "missing"
    return "ok" if GrammarExamples(sentences_path()).cache_version_ok() else "outdated"


# ------------------------------------------------------------------------- background work

_lock = threading.Lock()
_activity: dict[str, str] = {}
"""Pack name -> what is happening right now ("downloading", "building", "error: ...")."""
_received: dict[str, int] = {}
"""Pack name -> bytes of the archive fetched so far (while ``downloading``)."""
_thread: threading.Thread | None = None
_reset_hooks: list[Callable[[], None]] = []


def on_installed(hook: Callable[[], None]) -> None:
    """Call ``hook`` after a pack was installed (to drop caches that hold the old data)."""
    _reset_hooks.append(hook)


def status() -> dict[str, dict[str, Any]]:
    """Per pack: ``state``, ``wanted`` and ``installed`` versions, and current ``activity``."""
    wanted = manifest()
    out: dict[str, dict[str, Any]] = {}
    for name, spec in SPECS.items():
        if spec.derived:
            entry: dict[str, Any] = {"state": _grammar_state(), "derived": True}
        else:
            mark = installed(name)
            want = wanted.get(name, {}).get("version")
            if not _present(spec):
                state = "missing"
            elif mark is None:
                state = "unversioned"
            else:
                state = "ok" if mark.get("version") == want else "outdated"
            entry = {"state": state, "wanted": want, "installed": (mark or {}).get("version")}
        if not spec.derived and name in wanted:
            entry["size"] = int(wanted[name].get("size", 0))
        with _lock:
            if name in _activity:
                entry["activity"] = _activity[name]
            if name in _received:
                entry["received"] = _received[name]
        out[name] = entry
    return out


def _set(name: str, activity: str | None) -> None:
    with _lock:
        _received.pop(name, None)
        if activity is None:
            _activity.pop(name, None)
        else:
            _activity[name] = activity


def _progress(name: str, received: int) -> None:
    with _lock:
        _received[name] = received


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


DEFAULT_PACKS_BASE = "https://data.vuurtoren.app"
"""Where published packs live: the data host, ``packs-<version>/<name>-<version>.tar.gz``."""


def _fetch(name: str, entry: dict[str, Any], dest: Path) -> str | None:
    """Put the verified archive at ``dest``; return its source, or None if no source has it."""
    file = archive_name(name, entry["version"])
    local = os.environ.get("VUURTOREN_PACKS_DIR")
    if local and (Path(local) / file).is_file():
        shutil.copyfile(Path(local) / file, dest)
        source = "bundled"
    else:
        url = os.environ.get("VUURTOREN_PACKS_URL", "").strip()
        if not url:
            # Default: the data host's folder for this pack's version.
            url = f"{DEFAULT_PACKS_BASE}/packs-{entry['version']}"
        elif url.lower() == "none":
            return None
        headers = {"User-Agent": "vuurtoren-nlp-packs"}
        token = os.environ.get("VUURTOREN_PACKS_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(f"{url.rstrip('/')}/{file}", headers=headers)
        limit = int(entry["size"])
        with urllib.request.urlopen(req, timeout=60) as resp, dest.open("wb") as fh:  # noqa: S310
            got = 0
            while chunk := resp.read(CHUNK):
                got += len(chunk)
                if got > limit:
                    raise ValueError(f"{file} is larger than the manifest says ({limit} bytes)")
                fh.write(chunk)
                _progress(name, got)
        source = "download"
    size = dest.stat().st_size
    sha = _sha256(dest)
    if size != int(entry["size"]) or sha != entry["sha256"]:
        raise ValueError(f"{file}: checksum mismatch (got {sha[:12]}..., {size} bytes)")
    return source


def _swap_in(spec: PackSpec, staged: Path) -> None:
    """Replace the target with ``staged`` (same directory, so renames are atomic)."""
    target = spec.target()
    if spec.kind == "file":
        os.replace(staged, target)
        return
    old = target.with_name(target.name + ".old")
    shutil.rmtree(old, ignore_errors=True)
    if target.exists():
        target.rename(old)
    staged.rename(target)
    shutil.rmtree(old, ignore_errors=True)


def _write_marker(spec: PackSpec, version: str, sha256: str | None, source: str) -> None:
    mark = {"name": spec.name, "version": version, "sha256": sha256, "source": source}
    mark["installed"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tmp = marker_path(spec.target()).with_suffix(".tmp")
    tmp.write_text(json.dumps(mark, indent=1) + "\n")
    os.replace(tmp, marker_path(spec.target()))


def install(name: str, allow_build: bool) -> str:
    """Install one downloadable pack at the manifest version; returns how ("download", ...).

    Raises:
        RuntimeError: no source has it (no bundled archive, no URL and building not allowed).
    """
    spec = SPECS[name]
    entry = manifest()[name]
    target = spec.target()
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent, prefix=f".{name}-") as d:
        work = Path(d)
        archive = work / "pack.tar.gz"
        source = None
        if entry.get("sha256"):
            _set(name, "downloading")
            source = _fetch(name, entry, archive)
        if source is not None:
            _set(name, "installing")
            with tarfile.open(archive) as tar:
                tar.extractall(work / "x", filter="data")
            staged = work / "x" / target.name
            if not staged.exists():
                raise ValueError(f"{name} archive has no {target.name}")
            sha: str | None = entry["sha256"]
            if name in PHONE_PACKS:
                _keep_archive(name, entry["version"], archive)
        elif allow_build and spec.build is not None:
            _set(name, "building")
            staged = work / target.name
            subprocess.run(spec.build(staged), check=True, cwd=SCRIPTS_DIR.parent)
            sha, source = None, "build"
        else:
            raise RuntimeError(
                f"{name}: no source (set VUURTOREN_PACKS_URL or VUURTOREN_PACKS_DIR, "
                "or VUURTOREN_PACKS=auto to build it here)"
            )
        _swap_in(spec, staged)
        _write_marker(spec, entry["version"], sha, source)
    return source


def _build_grammar_cache() -> None:
    from vuurtoren_nlp.grammar import TOPICS
    from vuurtoren_nlp.grammar_examples import MAX_PER_TOPIC, GrammarExamples

    scanner = GrammarExamples(sentences_path())
    if not scanner.writable():
        raise RuntimeError(f"cannot write {scanner.cache_db}")
    # Same stopping rule as scripts/build_grammar_examples.py: every topic full, the DB done or
    # GRAMMAR_SCAN_MAX sentences scanned (rare topics then fill up lazily on request).
    while True:
        counts = [len(scanner.examples(t, MAX_PER_TOPIC, budget_s=0.5)) for t in sorted(TOPICS)]
        scanned, finished = scanner.progress()
        if all(n >= MAX_PER_TOPIC for n in counts) or finished or scanned >= GRAMMAR_SCAN_MAX:
            return


def grammar_archive_name() -> str:
    """The bundled grammar-example cache that fits the shipped sentence pack and the detectors."""
    from vuurtoren_nlp.grammar_examples import detector_version

    sentences = manifest().get("sentences-nl", {}).get("version", "none")
    return f"grammar-examples-nl-{sentences}-{detector_version()}.tar.gz"


def _install_bundled_grammar() -> bool:
    """Unpack the bundled grammar-example cache when there is one that fits; True if done."""
    from vuurtoren_nlp.grammar_examples import GrammarExamples

    local = os.environ.get("VUURTOREN_PACKS_DIR")
    archive = Path(local) / grammar_archive_name() if local else None
    mark = installed("sentences-nl")
    wanted = manifest().get("sentences-nl", {}).get("version")
    if archive is None or not archive.is_file() or not mark or mark.get("version") != wanted:
        return False
    target = grammar_cache_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent, prefix=".grammar-examples-") as d:
        with tarfile.open(archive) as tar:
            tar.extractall(d, filter="data")
        staged = Path(d) / "grammar-examples-nl.sqlite"
        if not staged.is_file() or not GrammarExamples(sentences_path(), staged).cache_version_ok():
            return False
        os.replace(staged, target)
    return True


def ensure(force: bool = False, allow_build: bool | None = None) -> dict[str, str]:
    """Install every missing/outdated pack (``force``: also replace unversioned ones).

    Returns ``{name: result}`` ("ok", "download", "build", "bundled", "error: ...").
    """
    if allow_build is None:
        allow_build = mode() == "auto"
    results: dict[str, str] = {}
    states = status()
    published = manifest()
    for name, spec in SPECS.items():
        state = _grammar_state() if spec.derived else states[name]["state"]
        try:
            if spec.derived:
                if state != "ok" and sentences_path().is_file():
                    if _install_bundled_grammar():
                        results[name] = "bundled"
                    else:
                        _set(name, "building")
                        _build_grammar_cache()
                        results[name] = "build"
                else:
                    results[name] = "ok" if state == "ok" else "skipped: no sentences"
            elif name not in published:
                results[name] = "skipped: not published" if state == "missing" else "ok"
            elif state in ("missing", "outdated") or (force and state == "unversioned"):
                results[name] = install(name, allow_build)
                if name == "sentences-nl":
                    # The example cache indexes the old sentence DB: rebuild it below.
                    grammar_cache_path().unlink(missing_ok=True)
                for hook in _reset_hooks:
                    hook()
            else:
                results[name] = "ok"
            _set(name, None)
        except Exception as e:  # noqa: BLE001 - reported in /health, the next pack still runs
            log.exception("data pack %s failed", name)
            results[name] = f"error: {e}"
            _set(name, f"error: {e}")
    return results


def ensure_in_background(force: bool = False) -> bool:
    """Start :func:`ensure` in a thread unless one is running; True if started."""
    global _thread
    with _lock:
        if _thread is not None and _thread.is_alive():
            return False
        _thread = threading.Thread(
            target=ensure, kwargs={"force": force}, name="vuurtoren-packs", daemon=True
        )
        _thread.start()
        return True


def busy() -> bool:
    return _thread is not None and _thread.is_alive()
