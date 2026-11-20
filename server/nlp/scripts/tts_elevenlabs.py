"""Make the starter-word audio with the ElevenLabs API, in a female and a male voice.

    python scripts/tts_elevenlabs.py manifest --out-dir ~/Downloads/vuurtoren-audio-jobs
    ELEVENLABS_API_KEY=… python scripts/tts_elevenlabs.py speak \
        --chunk ~/Downloads/vuurtoren-audio-jobs/chunk-01.json --gender female --voice <voice id> \
        --out ~/Downloads/vuurtoren-audio

`manifest` splits every clip (nouns with their article, "het huis", and every example sentence)
into chunks of about 14,500 characters: one chunk in both voices is about 29,000 characters.
`speak` writes `<out>/<gender>/<id>.mp3`. A clip's id comes from its text, so a rebuilt list
reuses every clip it still needs, and a run can stop and resume: existing files are skipped.
How to run it: docs/audio.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LIST = ROOT / "content" / "starter" / "nl-5000.json"
API = "https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_64"
MODEL = "eleven_multilingual_v2"


def clip_id(kind: str, text: str) -> str:
    return f"{kind}-{hashlib.sha1(text.encode()).hexdigest()[:16]}"


def manifest() -> list[dict]:
    words = json.loads(LIST.read_text())["words"]
    clips = []
    for w in words:
        said = f"{w['article']} {w['word']}" if w.get("article") else w["word"]
        clips.append(
            {"id": clip_id("word", said), "kind": "word", "lemma": w["word"], "text": said}
        )
        if w.get("sentence"):
            s = w["sentence"]
            clips.append(
                {"id": clip_id("sentence", s), "kind": "sentence", "lemma": w["word"], "text": s}
            )
    return clips


def speak(clip: dict, voice: str, key: str, out: Path) -> None:
    body = json.dumps({"text": clip["text"], "model_id": MODEL}).encode()
    req = urllib.request.Request(
        API.format(voice=voice),
        data=body,
        headers={"xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg"},
    )
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
                tmp = out.with_suffix(".part")
                tmp.write_bytes(resp.read())
                tmp.rename(out)
                return
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 5:
                time.sleep(2**attempt)
                continue
            raise SystemExit(f"{clip['id']}: HTTP {e.code} {e.read()[:300]!r}") from e


def chunks(clips: list[dict], size: int) -> list[list[dict]]:
    out: list[list[dict]] = [[]]
    used = 0
    for c in clips:
        if out[-1] and used + len(c["text"]) > size:
            out.append([])
            used = 0
        out[-1].append(c)
        used += len(c["text"])
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("manifest")
    m.add_argument("--out-dir", type=Path, required=True)
    m.add_argument("--chunk-chars", type=int, default=14_500)
    s = sub.add_parser("speak")
    s.add_argument("--chunk", type=Path, required=True)
    s.add_argument("--gender", choices=["female", "male"], required=True)
    s.add_argument("--voice", required=True, help="ElevenLabs voice id")
    s.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()

    if a.cmd == "manifest":
        out = a.out_dir.expanduser()
        out.mkdir(parents=True, exist_ok=True)
        clips = manifest()
        parts = chunks(clips, a.chunk_chars)
        for i, part in enumerate(parts, 1):
            chars = sum(len(c["text"]) for c in part)
            (out / f"chunk-{i:02d}.json").write_text(
                json.dumps(
                    {"model": MODEL, "chars": chars, "clips": part}, ensure_ascii=False, indent=1
                )
            )
        total = sum(len(c["text"]) for c in clips)
        print(f"{len(clips)} clips, {total} characters, {len(parts)} chunks → {out}")
        print(f"both voices: {2 * total} characters, about {2 * a.chunk_chars} per chunk")
        return

    key = os.environ.get("ELEVENLABS_API_KEY") or sys.exit("Set ELEVENLABS_API_KEY.")
    part = json.loads(a.chunk.expanduser().read_text())["clips"]
    out = a.out.expanduser() / a.gender
    out.mkdir(parents=True, exist_ok=True)
    made = spent = 0
    for c in part:
        target = out / f"{c['id']}.mp3"
        if target.exists():
            continue
        speak(c, a.voice, key, target)
        made += 1
        spent += len(c["text"])
        if made % 50 == 0:
            print(f"{made} clips, {spent} characters")
    print(f"{a.chunk.name} {a.gender}: {made} new clips, {spent} characters")


if __name__ == "__main__":
    main()
