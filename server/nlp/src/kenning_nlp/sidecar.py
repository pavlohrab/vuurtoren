"""Entry point of the desktop sidecar (D4): the language server inside the Kenning desktop app.

The desktop app (apps/desktop, ``src/sidecar.rs``) starts this as a child process with:

* ``KENNING_PORT``       a free port on 127.0.0.1 chosen by the app;
* ``KENNING_NLP_TOKEN``  a random token every request must carry (see ``app.require_token``);
* ``KENNING_DATA_DIR``   the app's data directory (data packs), ``KENNING_PACKS=download``;
* stdin as a pipe that stays open while the app runs.

When the app goes away, even by a crash, stdin reaches end-of-file and this process exits, so
no language server is left running in the background.
"""

from __future__ import annotations

import os
import sys
import threading


def _exit_with_parent() -> None:
    try:
        while sys.stdin.buffer.read(1024):
            pass
    except (OSError, ValueError, AttributeError):
        return  # no usable stdin (started by hand): keep running
    os._exit(0)


def main() -> None:
    port = int(os.environ.get("KENNING_PORT", "8000"))
    if os.environ.get("KENNING_EXIT_WITH_STDIN", "1") == "1" and sys.stdin is not None:
        threading.Thread(target=_exit_with_parent, name="kenning-parent", daemon=True).start()

    import uvicorn

    from kenning_nlp.app import app

    # Exactly one process (see the Dockerfile); loopback only.
    uvicorn.run(app, host="127.0.0.1", port=port, workers=1, log_level="warning")


if __name__ == "__main__":
    main()
