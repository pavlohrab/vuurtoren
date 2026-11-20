"""Make the starter-word audio with the ElevenLabs API.

    python scripts/tts_elevenlabs.py manifest  --out ~/Downloads/vuurtoren-audio-manifest.json
    ELEVENLABS_API_KEY=… python scripts/tts_elevenlabs.py speak \
        --manifest ~/Downloads/vuurtoren-audio-manifest.json --out ~/Downloads/vuurtoren-audio \
        --word-voice <voice id> --sentence-voice <voice id> [--limit 100] [--max-chars 280000]

One clip per word (nouns with their article: "het huis") and one per example sentence. A clip's
file name comes from its text, so a rebuilt list reuses every clip it still needs, and the run can
stop and resume: existing files are skipped. --max-chars stops before the plan's characters run
out.
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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("manifest")
    m.add_argument("--out", type=Path, required=True)
    s = sub.add_parser("speak")
    s.add_argument("--manifest", type=Path, required=True)
    s.add_argument("--out", type=Path, required=True)
    s.add_argument("--word-voice", required=True)
    s.add_argument("--sentence-voice", required=True)
    s.add_argument("--limit", type=int, default=0, help="stop after this many new clips")
    s.add_argument("--max-chars", type=int, default=0, help="stop before this many characters")
    a = ap.parse_args()

    if a.cmd == "manifest":
        clips = manifest()
        a.out.expanduser().write_text(
            json.dumps({"model": MODEL, "clips": clips}, ensure_ascii=False, indent=1)
        )
        chars = sum(len(c["text"]) for c in clips)
        print(f"{len(clips)} clips, {chars} characters → {a.out}")
        return

    key = os.environ.get("ELEVENLABS_API_KEY") or sys.exit("Set ELEVENLABS_API_KEY.")
    clips = json.loads(a.manifest.expanduser().read_text())["clips"]
    out = a.out.expanduser()
    out.mkdir(parents=True, exist_ok=True)
    made = spent = 0
    for c in clips:
        target = out / f"{c['id']}.mp3"
        if target.exists():
            continue
        if a.limit and made >= a.limit:
            break
        if a.max_chars and spent + len(c["text"]) > a.max_chars:
            print("Stopping before --max-chars.")
            break
        speak(c, a.word_voice if c["kind"] == "word" else a.sentence_voice, key, target)
        made += 1
        spent += len(c["text"])
        if made % 50 == 0:
            print(f"{made} clips, {spent} characters")
    print(f"done: {made} new clips, {spent} characters")


if __name__ == "__main__":
    main()
