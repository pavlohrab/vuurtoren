"""Service-level errors that map to ``{"detail": ...}`` JSON responses."""

from __future__ import annotations

from fastapi import UploadFile


class ServiceError(Exception):
    """An error with an HTTP status and a message safe to show to API clients."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


MAX_UPLOAD_BYTES = 30 * 1024 * 1024
"""Upload size limit for PDFs and images (30 MB)."""


async def read_upload(file: UploadFile, limit: int = MAX_UPLOAD_BYTES) -> bytes:
    """Read an uploaded file fully, failing with 413 as soon as it exceeds ``limit`` bytes.

    Raises:
        ServiceError: 413 if too large, 400 if empty.
    """
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(1 << 20):
        size += len(chunk)
        if size > limit:
            raise ServiceError(413, f"File too large (limit {limit // (1024 * 1024)} MB).")
        chunks.append(chunk)
    if size == 0:
        raise ServiceError(400, "Uploaded file is empty.")
    return b"".join(chunks)
