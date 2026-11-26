"""Data packs: install from a bundled directory or a URL, verify, swap in, report state."""

from __future__ import annotations

import hashlib
import http.server
import json
import sqlite3
import sys
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vuurtoren_nlp import packs
from vuurtoren_nlp.app import app

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_packs import make_archive  # noqa: E402


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    """Empty data dir, a dictionary-nl archive (a tiny SQLite file) and a manifest for it."""
    data = tmp_path / "data"
    for var in ("VUURTOREN_DICT_PATH", "VUURTOREN_SENTENCES_PATH", "VUURTOREN_MT_DIR"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.delenv("VUURTOREN_GRAMMAR_CACHE_PATH", raising=False)
    monkeypatch.setenv("VUURTOREN_DATA_DIR", str(data))
    for var in ("VUURTOREN_PACKS_URL", "VUURTOREN_PACKS_DIR", "VUURTOREN_PACKS_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    src = tmp_path / "src" / "dictionary-nl.sqlite"
    src.parent.mkdir()
    con = sqlite3.connect(src)
    con.execute("CREATE TABLE t (x)")
    con.commit()
    con.close()
    dist = tmp_path / "dist"
    dist.mkdir()
    archive = dist / "dictionary-nl-9.9.9.tar.gz"
    make_archive(src, archive)
    manifest = tmp_path / "packs.json"
    entry = {
        "version": "9.9.9",
        "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "size": archive.stat().st_size,
    }
    manifest.write_text(json.dumps({"format": 1, "packs": {"dictionary-nl": entry}}))
    monkeypatch.setattr(packs, "MANIFEST_PATH", manifest)
    return {"data": data, "dist": dist, "manifest": manifest}


def test_deterministic_archive(env: dict[str, Path], tmp_path: Path) -> None:
    again = tmp_path / "again.tar.gz"
    make_archive(tmp_path / "src" / "dictionary-nl.sqlite", again)
    assert again.read_bytes() == (env["dist"] / "dictionary-nl-9.9.9.tar.gz").read_bytes()


def test_missing_then_installed_from_bundled_dir(
    env: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    assert packs.status()["dictionary-nl"]["state"] == "missing"
    monkeypatch.setenv("VUURTOREN_PACKS_DIR", str(env["dist"]))
    hooks: list[int] = []
    monkeypatch.setattr(packs, "_reset_hooks", [lambda: hooks.append(1)])
    results = packs.ensure(allow_build=False)
    assert results["dictionary-nl"] == "bundled"
    assert hooks == [1]
    assert (env["data"] / "dictionary-nl.sqlite").is_file()
    st = packs.status()["dictionary-nl"]
    assert st["state"] == "ok" and st["installed"] == "9.9.9"
    # Nothing to do the second time.
    assert packs.ensure(allow_build=False)["dictionary-nl"] == "ok"


def test_phones_fetch_the_dictionary_archive_here(
    env: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    client = TestClient(app)
    file = "dictionary-nl-9.9.9.tar.gz"
    assert client.get(f"/packs/{file}").status_code == 404
    # Installed here from a bundled dir: the verified archive is kept and handed on.
    monkeypatch.setenv("VUURTOREN_PACKS_DIR", str(env["dist"]))
    packs.ensure(allow_build=False)
    monkeypatch.delenv("VUURTOREN_PACKS_DIR")
    archive = (env["dist"] / file).read_bytes()
    got = client.get(f"/packs/{file}")
    assert got.status_code == 200 and got.content == archive
    # A broken download goes on where it stopped.
    part = client.get(f"/packs/{file}", headers={"Range": "bytes=10-"})
    assert part.status_code == 206 and part.content == archive[10:]
    # Only phone packs, only at the manifest version.
    assert client.get("/packs/dictionary-nl-1.0.0.tar.gz").status_code == 404
    assert client.get("/packs/sentences-nl-9.9.9.tar.gz").status_code == 404


def test_outdated_pack_is_replaced_and_unversioned_kept(
    env: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    target = env["data"] / "dictionary-nl.sqlite"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"old")
    assert packs.status()["dictionary-nl"]["state"] == "unversioned"
    monkeypatch.setenv("VUURTOREN_PACKS_DIR", str(env["dist"]))
    assert packs.ensure(allow_build=False)["dictionary-nl"] == "ok"  # untouched
    assert target.read_bytes() == b"old"
    packs.marker_path(target).write_text(json.dumps({"version": "1.0.0"}))
    assert packs.status()["dictionary-nl"]["state"] == "outdated"
    assert packs.ensure(allow_build=False)["dictionary-nl"] == "bundled"
    assert target.read_bytes().startswith(b"SQLite format 3")


def test_download_from_url_and_checksum_mismatch(
    env: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    dist = env["dist"]

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw) -> None:  # type: ignore[no-untyped-def]
            super().__init__(*a, directory=str(dist), **kw)

        def log_message(self, *a) -> None:  # type: ignore[no-untyped-def]
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv("VUURTOREN_PACKS_URL", f"http://127.0.0.1:{server.server_port}/")
        # A tampered manifest digest: nothing is installed, the error is reported.
        manifest = json.loads(env["manifest"].read_text())
        good = manifest["packs"]["dictionary-nl"]["sha256"]
        manifest["packs"]["dictionary-nl"]["sha256"] = "0" * 64
        env["manifest"].write_text(json.dumps(manifest))
        assert packs.ensure(allow_build=False)["dictionary-nl"].startswith("error: ")
        assert not (env["data"] / "dictionary-nl.sqlite").exists()
        manifest["packs"]["dictionary-nl"]["sha256"] = good
        env["manifest"].write_text(json.dumps(manifest))
        assert packs.ensure(allow_build=False)["dictionary-nl"] == "download"
        assert packs.installed("dictionary-nl")["sha256"] == good  # type: ignore[index]
    finally:
        server.shutdown()


def test_no_source_is_an_error_not_a_crash(
    env: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VUURTOREN_PACKS_URL", "none")  # no default GitHub download in tests
    assert "no source" in packs.ensure(allow_build=False)["dictionary-nl"]


def test_health_and_admin_report_packs(env: dict[str, Path]) -> None:
    client = TestClient(app)
    body = client.get("/health").json()
    assert body["packs"]["mode"] in ("off", "download", "auto")
    assert body["packs"]["items"]["dictionary-nl"]["state"] == "missing"
    assert body["analyzerVersion"].startswith("a1-")
    assert client.get("/admin/packs").json()["items"]["dictionary-nl"]["wanted"] == "9.9.9"


def test_shipped_manifest_lists_the_downloadable_packs() -> None:
    manifest = json.loads((Path(packs.__file__).with_name("packs.json")).read_text())
    assert set(manifest["packs"]) == {
        "dictionary-nl",
        "sentences-nl",
        "mt-nl-en",
        "audio-nl",
        "tts-nl",
        "levels-nl",
    }
    # levels-nl is for phones only: the server has the file in its package (levels.py).
    assert set(manifest["packs"]) - {"levels-nl"} | {"grammar-examples-nl"} == set(packs.SPECS)


def test_download_progress_is_reported(env: dict[str, Path]) -> None:
    items = packs.status()
    assert items["dictionary-nl"]["size"] > 0
    assert "received" not in items["dictionary-nl"]
    packs._set("dictionary-nl", "downloading")
    packs._progress("dictionary-nl", 1234)
    try:
        entry = packs.status()["dictionary-nl"]
        assert entry["activity"] == "downloading"
        assert entry["received"] == 1234
    finally:
        packs._set("dictionary-nl", None)
    assert "received" not in packs.status()["dictionary-nl"]


def _grammar_bundle(env: dict[str, Path], tmp_path: Path, version: str) -> None:
    """Installed sentences (marker at 1.0), a manifest with them, and a bundled grammar cache
    built by detectors of ``version``."""
    from vuurtoren_nlp.grammar_examples import detector_version

    sentences = env["data"] / "sentences-nl.sqlite"
    sentences.parent.mkdir(parents=True, exist_ok=True)
    sqlite3.connect(sentences).close()
    (env["data"] / "sentences-nl.sqlite.pack.json").write_text(json.dumps({"version": "1.0"}))
    manifest = json.loads(env["manifest"].read_text())
    manifest["packs"]["sentences-nl"] = {"version": "1.0", "sha256": "x", "size": 1}
    env["manifest"].write_text(json.dumps(manifest))
    cache = tmp_path / "g" / "grammar-examples-nl.sqlite"
    cache.parent.mkdir()
    con = sqlite3.connect(cache)
    con.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    con.execute("INSERT INTO meta VALUES ('version', ?)", (version,))
    con.commit()
    con.close()
    make_archive(cache, env["dist"] / f"grammar-examples-nl-1.0-{detector_version()}.tar.gz")


def test_bundled_grammar_examples_are_unpacked_not_built(
    env: dict[str, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from vuurtoren_nlp.grammar_examples import detector_version

    _grammar_bundle(env, tmp_path, detector_version())
    monkeypatch.setenv("VUURTOREN_PACKS_DIR", str(env["dist"]))
    monkeypatch.setattr(packs, "_build_grammar_cache", lambda: pytest.fail("built on device"))
    assert packs.grammar_archive_name() == f"grammar-examples-nl-1.0-{detector_version()}.tar.gz"
    assert packs.ensure(allow_build=False)["grammar-examples-nl"] == "bundled"
    assert packs.status()["grammar-examples-nl"]["state"] == "ok"


def test_a_bundled_grammar_cache_of_other_detectors_is_built_again(
    env: dict[str, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _grammar_bundle(env, tmp_path, "older-detectors")
    monkeypatch.setenv("VUURTOREN_PACKS_DIR", str(env["dist"]))
    built: list[int] = []
    monkeypatch.setattr(packs, "_build_grammar_cache", lambda: built.append(1))
    assert packs.ensure(allow_build=False)["grammar-examples-nl"] == "build"
    assert built == [1]
