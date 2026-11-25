"""Generate audition clips and offline Dutch MP3s with Google Chirp 3 HD."""

from __future__ import annotations

import argparse
import base64
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock

from tts_elevenlabs import ROOT, clip_id, manifest

API = "https://texttospeech.googleapis.com/v1/text:synthesize"
VOICES = {
    "female": ("Achernar", "Zephyr", "Aoede", "Kore", "Leda", "Sulafat"),
    "male": ("Achird", "Zubenelgenubi", "Charon", "Puck", "Orus", "Sadaltager"),
}
AUDITION = (
    "de kust",
    "het huis",
    "uit",
    "de deur",
    "gezellig",
    "Scheveningen",
    "de trein",
    "het geluid",
    "Ik bel je morgen op.",
    "Rijd je met de trein of ga je op de fiets?",
    "De buurvrouw heeft haar sleutels thuis laten liggen.",
    "Op 21 november vertrekt de trein om kwart over acht.",
)


def stories() -> list[dict]:
    return json.loads((ROOT / "content/stories/stories.json").read_text(encoding="utf-8"))[
        "stories"
    ]


def clip(kind: str, text: str) -> dict:
    return {"id": clip_id(kind, text), "text": text}


def paragraphs(story: dict) -> list[dict]:
    return [clip("paragraph", p.strip()) for p in story["content"].split("\n\n") if p.strip()]


def access_token() -> str:
    try:
        return subprocess.check_output(
            ["gcloud", "auth", "application-default", "print-access-token"],
            text=True,
        ).strip()
    except subprocess.CalledProcessError as e:
        raise RuntimeError("Could not refresh Google Application Default Credentials.") from e


class RequestBudget:
    def __init__(self, requests_per_minute: int) -> None:
        self.interval = 60 / requests_per_minute
        self.lock = Lock()
        self.next_request = 0.0
        self.refresh_at = 0.0
        self.token = ""

    def authorize(self) -> str:
        with self.lock:
            time.sleep(max(0.0, self.next_request - time.monotonic()))
            if time.monotonic() >= self.refresh_at:
                self.token = access_token()
                self.refresh_at = time.monotonic() + 3000
            self.next_request = time.monotonic() + self.interval
            return self.token


def speak(text: str, voice: str, project: str, budget: RequestBudget) -> bytes:
    body = json.dumps(
        {
            "input": {"text": text},
            "voice": {"languageCode": "nl-NL", "name": f"nl-NL-Chirp3-HD-{voice}"},
            "audioConfig": {"audioEncoding": "MP3"},
        }
    ).encode()
    for attempt in range(5):
        request = urllib.request.Request(
            API,
            data=body,
            headers={
                "Authorization": f"Bearer {budget.authorize()}",
                "x-goog-user-project": project,
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
                audio = base64.b64decode(json.load(response)["audioContent"], validate=True)
                if not audio:
                    raise ValueError("Google returned an empty audio clip")
                return audio
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 4:
                raise
        time.sleep(2**attempt)
    raise AssertionError("Synthesis retry loop exhausted")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("audition", "starter", "story", "stories"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--project", help="Billing-enabled Google Cloud project ID")
    parser.add_argument("--voice", nargs=2, metavar=("FEMALE", "MALE"))
    parser.add_argument(
        "--audition-voices",
        nargs="+",
        choices=[v for group in VOICES.values() for v in group],
        help="Generate only these voices in audition mode",
    )
    parser.add_argument("--story", help="Bundled story slug for story mode")
    parser.add_argument("--requests-per-minute", type=int, default=180)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.requests_per_minute < 1:
        parser.error("--requests-per-minute must be positive")

    if args.audition_voices and args.mode != "audition":
        parser.error("--audition-voices is only available in audition mode")

    if args.mode == "audition":
        library = stories()
        clips = [clip("word" if i < 8 else "sentence", t) for i, t in enumerate(AUDITION)]
        clips.extend(
            paragraphs(next(s for s in library if s["level"] == level))[0] for level in ("A1", "B1")
        )
        selected = args.audition_voices or [v for group in VOICES.values() for v in group]
        voices = [(voice, voice) for voice in dict.fromkeys(selected)]
    else:
        if not args.voice or any(
            v not in VOICES[g] for g, v in zip(VOICES, args.voice, strict=True)
        ):
            female, male = (",".join(group) for group in VOICES.values())
            parser.error(f"select --voice {{{female}}} {{{male}}}")
        voices = list(zip(VOICES, args.voice, strict=True))
        if args.mode == "starter":
            clips = list({c["id"]: c for c in manifest()}.values())
        elif args.mode == "stories":
            library = stories()
            index = {}
            by_id = {}
            for story in library:
                sentences = [
                    clip("sentence", story["content"][start:end])
                    for start, end, _translation in story["sentences"]
                ]
                narration = paragraphs(story)
                index[story["slug"]] = {
                    "sentences": [c["id"] for c in sentences],
                    "paragraphs": [c["id"] for c in narration],
                }
                by_id.update((c["id"], c) for c in sentences + narration)
            clips = list(by_id.values())
        else:
            story = next((s for s in stories() if s["slug"] == args.story), None)
            if story is None:
                parser.error("story mode requires a valid --story slug")
            clips = paragraphs(story)

    if args.mode == "audition":
        clips = [{**c, "id": f"{index:02d}-{c['id']}"} for index, c in enumerate(clips, 1)]

    out = args.out.expanduser()
    jobs = [
        (out / folder / f"{c['id']}.mp3", c["text"], voice)
        for folder, voice in voices
        for c in clips
    ]
    pending = [(p, t, v) for p, t, v in jobs if not p.exists() or not p.stat().st_size]
    print(
        f"{len(pending):,} new clips, {sum(len(t) for _, t, _ in pending):,} characters", flush=True
    )
    if args.dry_run:
        return
    if args.mode == "stories":
        out.mkdir(parents=True, exist_ok=True)
        (out / "stories.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    if not pending:
        return
    if not args.project:
        parser.error("--project is required to synthesize audio")
    if not shutil.which("gcloud"):
        parser.error("install the Google Cloud CLI and authenticate before synthesizing")

    budget = RequestBudget(args.requests_per_minute)

    def generate(job: tuple[Path, str, str]) -> None:
        path, line, voice = job
        try:
            audio = speak(line, voice, args.project, budget)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{path.name} ({voice}): Google returned HTTP {e.code}") from e
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(audio)
        tmp.replace(path)

    with ThreadPoolExecutor(max_workers=8) as executor:
        try:
            for i, _ in enumerate(executor.map(generate, pending), 1):
                if i % 50 == 0 or i == len(pending):
                    print(f"{i:,}/{len(pending):,} clips written", flush=True)
        except (Exception, KeyboardInterrupt):
            executor.shutdown(cancel_futures=True)
            raise


if __name__ == "__main__":
    main()
