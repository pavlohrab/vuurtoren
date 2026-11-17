"""The pinned-download helper used by the dictionary and sentence builds."""

import hashlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from pinned_download import PinMismatchError, verify  # noqa: E402


def _file(tmp_path: Path, data: bytes = b"hello") -> Path:
    p = tmp_path / "f.bin"
    p.write_bytes(data)
    return p


def test_matching_pin_passes(tmp_path: Path) -> None:
    p = _file(tmp_path)
    assert (
        verify(p, "x", hashlib.sha256(b"hello").hexdigest(), 5)
        == hashlib.sha256(b"hello").hexdigest()
    )


def test_mismatch_raises_with_guidance(tmp_path: Path) -> None:
    p = _file(tmp_path)
    with pytest.raises(PinMismatchError, match="accept-new-upstream"):
        verify(p, "x", "0" * 64, 5)


def test_size_mismatch_raises(tmp_path: Path) -> None:
    p = _file(tmp_path)
    with pytest.raises(PinMismatchError):
        verify(p, "x", hashlib.sha256(b"hello").hexdigest(), 6)


def test_accept_new_upstream_overrides(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    p = _file(tmp_path)
    verify(p, "x", "0" * 64, 5, accept_new=True)
    assert hashlib.sha256(b"hello").hexdigest() in capsys.readouterr().err


def test_no_pin_skips_check(tmp_path: Path) -> None:
    verify(_file(tmp_path), "x", None)
