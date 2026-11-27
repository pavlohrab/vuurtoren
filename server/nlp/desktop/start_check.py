"""Start the built sidecar the way the desktop app does and wait for ``/health``.

    python server/nlp/desktop/start_check.py [path/to/vuurtoren-nlp[.exe]]

CI runs it on every OS after build_sidecar.py, so a server that can't start on Windows or macOS
fails the build instead of the user's first start. Prints the exit code and whatever the server
wrote if it doesn't answer within two minutes.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
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
            code = proc.poll()
            if code is None:
                proc.kill()
                proc.wait()
        text = log.read_text(errors="replace")
    if ok:
        print(f"sidecar answered /health after {took:.0f} s")
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
