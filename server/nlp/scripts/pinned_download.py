"""Download a file and verify it against a pinned SHA-256 (standard library only).

Kaikki and Tatoeba publish only a rolling "latest" export, so the build records the digest of the
snapshot the shipped data was built from. When upstream moves on, the digest no longer matches and
the build stops with a clear message instead of silently producing different data. To accept a new
upstream, re-run with ``--accept-new-upstream`` (or the ``*_ACCEPT_NEW=1`` Docker build-arg), then
copy the digest printed at the end into the constants next to the URL.
"""

from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

CHUNK = 1 << 20


class PinMismatchError(RuntimeError):
    """The downloaded file is not the pinned snapshot."""


def sha256_of(path: Path) -> str:
    """Hex SHA-256 of a file."""
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def verify(
    path: Path,
    label: str,
    sha256: str | None,
    size: int | None = None,
    accept_new: bool = False,
) -> str:
    """Check ``path`` against the pin; return its actual digest.

    Raises :class:`PinMismatchError` on mismatch unless ``accept_new`` is true, in which case the
    new digest and size are printed so the pin can be updated. An empty/None pin skips the check.
    """
    actual = sha256_of(path)
    actual_size = path.stat().st_size
    bad_size = size is not None and actual_size != size
    bad_sha = sha256 is not None and actual != sha256
    if not (bad_size or bad_sha):
        print(f"{label}: sha256 {actual[:12]}... matches the pinned snapshot")
        return actual
    if accept_new:
        print(
            f"{label}: upstream changed, accepting the new snapshot.\n"
            f"  new sha256 = {actual}\n  new size   = {actual_size}\n"
            "  Update the pin in the build script to make this build reproducible again.",
            file=sys.stderr,
        )
        return actual
    raise PinMismatchError(
        f"{label} does not match the pinned snapshot.\n"
        f"  expected sha256 {sha256} ({size} bytes)\n"
        f"  got      sha256 {actual} ({actual_size} bytes)\n"
        "The upstream file was probably refreshed (they only publish 'latest'). To build with the\n"
        "new data anyway, pass --accept-new-upstream (Docker: --build-arg <NAME>_ACCEPT_NEW=1),\n"
        "then record the new digest in the script. To use a file you trust, pass --sha256 <hex>."
    )


def download(url: str, dest: Path, user_agent: str) -> None:
    """Stream ``url`` to ``dest`` (via a .part file), printing the size up front."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 (https URL from caller)
        total = int(resp.headers.get("Content-Length", 0))
        print(f"Downloading {url} ({total / 1e6:.1f} MB)")
        part = dest.with_name(dest.name + ".part")
        with part.open("wb") as fh:
            while chunk := resp.read(CHUNK):
                fh.write(chunk)
    part.replace(dest)


def download_verified(
    url: str,
    dest: Path,
    label: str,
    sha256: str | None,
    size: int | None,
    accept_new: bool,
    user_agent: str,
) -> None:
    """Download ``url`` to ``dest`` and verify it; delete the file if the check fails."""
    download(url, dest, user_agent)
    try:
        verify(dest, label, sha256, size, accept_new)
    except PinMismatchError:
        dest.unlink(missing_ok=True)
        raise
