"""Start the built sidecar the way the desktop app does and wait for ``/health``.

    python server/nlp/desktop/start_check.py [path/to/vuurtoren-nlp[.exe]] [--packs DIR]

CI runs it on every OS after build_sidecar.py, so a server that can't start on Windows or macOS
fails the build instead of the user's first start. Prints the exit code and whatever the server
wrote if it doesn't answer within two minutes. With ``--packs DIR`` (pack archives, as the
offline installer has them) it installs them first and also glosses and translates, as Add text
does.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
NAME = "vuurtoren-nlp"
# Text as pasted from Wikipedia: accents, curly quotes, a dash, a degree sign.
TEXT = "Één café in Den Haag – ‘gezellig’, zei ze. Het is 3 °C en de zee is ruw."


def call(port: int, path: str, payload: object | None = None, timeout: float = 120) -> object:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=None if payload is None else json.dumps(payload).encode(),
        headers={"X-Vuurtoren-Token": "check", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def steps(with_packs: bool) -> list[tuple[str, str, object]]:
    out: list[tuple[str, str, object]] = [
        ("analyse", "/analyze/text", {"lang": "nl", "texts": [TEXT]}),
        # Add text from a link: HTTPS with the computer's certificates.
        ("web page", "/extract/url", {"url": "https://nl.wikipedia.org/wiki/Kampen"}),
    ]
    if with_packs:
        out += [
            ("gloss", "/gloss", {"lang": "nl", "words": ["café", "zee", "ruw"]}),
            ("translate", "/translate", {"source": "nl", "target": "en", "texts": [TEXT]}),
        ]
    return out


def main() -> int:
    args = sys.argv[1:]
    packs = None
    if "--packs" in args:
        i = args.index("--packs")
        packs = Path(args[i + 1]).resolve()
        del args[i : i + 2]
    exe = (
        Path(args[0])
        if args
        else REPO
        / "apps"
        / "desktop"
        / "src-tauri"
        / "sidecar"
        / NAME
        / (NAME + (".exe" if os.name == "nt" else ""))
    )
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    ok, code, failed = False, None, ""
    with tempfile.TemporaryDirectory() as tmp:
        log = Path(tmp) / "log.txt"
        env = {
            **os.environ,
            "VUURTOREN_PORT": str(port),
            "VUURTOREN_NLP_TOKEN": "check",
            "VUURTOREN_DATA_DIR": str(Path(tmp) / "data"),
            "VUURTOREN_PACKS": "download" if packs else "off",
            "PYTHONUNBUFFERED": "1",
            "PYTHONUTF8": "1",
            "VUURTOREN_HANG_DUMP": "45",
        }
        for k in ("PYTHONHOME", "PYTHONPATH", "VUURTOREN_PACKS_DIR"):
            env.pop(k, None)
        if packs:
            env["VUURTOREN_PACKS_DIR"] = str(packs)
            env["VUURTOREN_PACKS_URL"] = "none"
        with log.open("wb") as out:
            proc = subprocess.Popen(
                [str(exe)],
                cwd=exe.parent,
                env=env,
                stdin=subprocess.PIPE,
                stdout=out,
                stderr=subprocess.STDOUT,
            )
            started = time.monotonic()
            while time.monotonic() - started < 120 and proc.poll() is None:
                try:
                    call(port, "/health", timeout=5)
                    ok = True
                    break
                except OSError:
                    time.sleep(2)
            took = time.monotonic() - started
            print(f"/health: {'answered' if ok else 'no answer'} after {took:.0f} s")
            if ok and packs:
                # A text added while the packs still install (the app's first minutes).
                t = time.monotonic()
                try:
                    call(port, "/analyze/text", {"lang": "nl", "texts": [TEXT]})
                    print(f"analyse while installing: {time.monotonic() - t:.1f} s")
                except OSError as e:
                    print(
                        f"analyse while installing failed after {time.monotonic() - t:.0f} s: {e}"
                    )
                t = time.monotonic()
                state: object = None
                while time.monotonic() - t < 600:
                    state = call(port, "/admin/packs", timeout=30)
                    if not state["busy"]:  # type: ignore[index]
                        break
                    time.sleep(3)
                print(f"packs after {time.monotonic() - t:.0f} s: {json.dumps(state)[:600]}")
            for name, path, payload in steps(packs is not None) if ok else []:
                t = time.monotonic()
                try:
                    answer = call(port, path, payload)
                    print(f"{name}: {time.monotonic() - t:.1f} s, {json.dumps(answer)[:160]}")
                except urllib.error.HTTPError as e:
                    body = e.read()[:2000].decode("utf-8", "replace")
                    ok, failed = False, f"{name} failed: {e.code} {body}"
                    break
                except OSError as e:
                    ok, failed = False, f"{name} failed after {time.monotonic() - t:.0f} s: {e}"
                    break
            code = proc.poll()
            if code is None:
                proc.kill()
                proc.wait()
        written = log.read_text("utf-8", errors="replace")
    if ok:
        print("sidecar ok")
        return 0
    print(failed or "sidecar did not answer /health")
    print(f"exit code {code}" + (f" = 0x{code & 0xFFFFFFFF:08X}" if code else ""))
    print("--- what it wrote ---")
    print(written or "(nothing)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
