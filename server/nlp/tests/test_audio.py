"""The audio pack: clip ids (shared with the app), the /audio route and --audio-from."""

from __future__ import annotations

import json
import sys
import tarfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vuurtoren_nlp import audio, packs
from vuurtoren_nlp.app import app

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import build_packs  # noqa: E402
import tts_elevenlabs  # noqa: E402

FIXTURE = Path(__file__).with_name("fixtures") / "audio-ids.json"


def test_clip_ids_match_the_tts_script_and_the_shared_fixture() -> None:
    # apps/web reads the same fixture (packages/anki/src/audio.test.ts).
    for case in json.loads(FIXTURE.read_text())["cases"]:
        assert audio.clip_id(case["kind"], case["text"]) == case["id"]
        assert tts_elevenlabs.clip_id(case["kind"], case["text"]) == case["id"]


def test_clips_are_served_and_missing_ones_are_404(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VUURTOREN_AUDIO_DIR", str(tmp_path / "audio-nl"))
    client = TestClient(app)
    clip = audio.clip_id("word", "het huis")
    assert client.get(f"/audio/female/{clip}.mp3").status_code == 404  # no pack at all
    (tmp_path / "audio-nl" / "female").mkdir(parents=True)
    (tmp_path / "audio-nl" / "female" / f"{clip}.mp3").write_bytes(b"ID3fake")
    res = client.get(f"/audio/female/{clip}.mp3")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/mpeg"
    assert res.content == b"ID3fake"
    assert client.get(f"/audio/male/{clip}.mp3").status_code == 404
    assert client.get("/audio/robot/" + clip + ".mp3").status_code == 404
    assert client.get("/audio/female/..%2F..%2Fsecret.mp3").status_code == 404


def test_audio_pack_is_skipped_until_published(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest = tmp_path / "packs.json"
    manifest.write_text(json.dumps({"format": 1, "packs": {}}))
    monkeypatch.setattr(packs, "MANIFEST_PATH", manifest)
    monkeypatch.setenv("VUURTOREN_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(packs, "SPECS", {"audio-nl": packs.SPECS["audio-nl"]})
    assert packs.status()["audio-nl"]["state"] == "missing"
    assert packs.ensure(allow_build=False) == {"audio-nl": "skipped: not published"}


def test_audio_from_packs_a_folder_and_it_installs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src = tmp_path / "clips"
    for voice in ("female", "male"):
        (src / voice).mkdir(parents=True)
        (src / voice / "word-0123456789abcdef.mp3").write_bytes(voice.encode())
    manifest = {"format": 1, "packs": {"dictionary-nl": {"version": "1.2.3"}}}
    dist = tmp_path / "dist"
    dist.mkdir()
    assert build_packs.audio_from(manifest, src, dist, None) == 0
    entry = manifest["packs"]["audio-nl"]
    assert entry["version"] == "1.2.3"
    archive = dist / "audio-nl-1.2.3.tar.gz"
    with tarfile.open(archive) as tar:
        assert "audio-nl/male/word-0123456789abcdef.mp3" in tar.getnames()

    (tmp_path / "packs.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(packs, "MANIFEST_PATH", tmp_path / "packs.json")
    monkeypatch.setenv("VUURTOREN_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("VUURTOREN_AUDIO_DIR", raising=False)
    monkeypatch.setenv("VUURTOREN_PACKS_DIR", str(dist))
    assert packs.install("audio-nl", allow_build=False) == "bundled"
    assert audio.clip_path("male", "word-0123456789abcdef") is not None

    (src / "female" / "notes.txt").write_text("x")
    assert build_packs.audio_from(manifest, src, dist, None) == 1
