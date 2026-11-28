"""Start the built sidecar the way the desktop app does and wait for ``/health``.

    python server/nlp/desktop/start_check.py [path/to/vuurtoren-nlp[.exe]]

CI runs it on every OS after build_sidecar.py, so a server that can't start on Windows or macOS
fails the build instead of the user's first start. Prints the exit code and whatever the server
wrote if it doesn't answer within two minutes.
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


def main() -> int:
    exe = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else (
            REPO
            / "apps"
            / "desktop"
            / "src-tauri"
            / "sidecar"
            / NAME
            / (NAME + (".exe" if os.name == "nt" else ""))
        )
    )
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    with tempfile.TemporaryDirectory() as tmp:
        log = Path(tmp) / "log.txt"
        env = {
            **os.environ,
            "VUURTOREN_PORT": str(port),
            "VUURTOREN_NLP_TOKEN": "check",
            "VUURTOREN_DATA_DIR": str(Path(tmp) / "data"),
            "VUURTOREN_PACKS": "off",
            "PYTHONUNBUFFERED": "1",
            "PYTHONUTF8": "1",
            "VUURTOREN_HANG_DUMP": "45",
        }
        for k in ("PYTHONHOME", "PYTHONPATH", "VUURTOREN_PACKS_DIR"):
            env.pop(k, None)
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
            ok = False
            while time.monotonic() - started < 120 and proc.poll() is None:
                req = urllib.request.Request(
                    f"http://127.0.0.1:{port}/health", headers={"X-Vuurtoren-Token": "check"}
                )
                try:
                    with urllib.request.urlopen(req, timeout=5) as r:
                        ok = r.status == 200
                        break
                except OSError:
                    time.sleep(2)
            took = time.monotonic() - started
            if ok:
                # What Add text does first: analyse a Dutch sentence.
                # Text as pasted from Wikipedia: accents, curly quotes, a dash, a degree sign.
                text = "Één café in Den Haag – ‘gezellig’, zei ze. Het is 3 °C en de zee is ruw."
                body = json.dumps({"lang": "nl", "texts": [text]}).encode()
                req = urllib.request.Request(
                    f"http://127.0.0.1:{port}/analyze/text",
                    data=body,
                    headers={"X-Vuurtoren-Token": "check", "Content-Type": "application/json"},
                )
                try:
                    with urllib.request.urlopen(req, timeout=120) as r:
                        print("analyse:", r.read()[:200].decode(errors="replace"))
                except urllib.error.HTTPError as e:
                    ok = False
                    print(f"analyse failed: {e.code} {e.read()[:2000].decode(errors='replace')}")
                except OSError as e:
                    ok = False
                    print(f"analyse failed: {e}")
            code = proc.poll()
            if code is None:
                proc.kill()
                proc.wait()
        text = log.read_text(errors="replace")
    if ok:
        print(f"sidecar answered /health after {took:.0f} s and analysed a sentence")
        return 0
    print(
        f"sidecar did not answer /health ({took:.0f} s, exit code {code}"
        + (f" = 0x{code & 0xFFFFFFFF:08X}" if code else "")
        + ")"
    )
    print("--- what it wrote ---")
    print(text or "(nothing)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
