"""Background OCR jobs for course import (a whole book, page by page, with progress).

``POST /course/ocr`` accepts a PDF or image upload and starts a job; ``GET /course/ocr/{id}``
reports progress and returns the pages finished so far (``?after=N`` returns only pages with
index >= N, so a client can poll cheaply). The upload and the rendered pages live only in memory
for the job's lifetime; finished jobs are dropped after :data:`JOB_TTL_SECONDS`. Recognised page
text is cached by the hash of the page image so that re-importing the same book is instant.

Each page is returned as layout *blocks* (Tesseract blocks with a normalised bounding box and the
text, lines joined by newlines) plus the full page text. Interpretation (headers, exercises,
units) is done by the client's pure course logic; this module only does I/O.
"""

from __future__ import annotations

import hashlib
import io
import threading
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

from PIL import Image, UnidentifiedImageError

from kenning_nlp.errors import ServiceError
from kenning_nlp.ocr import MAX_FRAMES, ensure_tesseract, ocr_image_data
from kenning_nlp.pdf import OCR_DPI, PDFIUM_LOCK, _open, is_pdf

MAX_COURSE_PAGES = 400
COURSE_MAX_UPLOAD_BYTES = 200 * 1024 * 1024
"""A scanned book can be large; course uploads are allowed up to 200 MB."""
JOB_TTL_SECONDS = 3600
MAX_JOBS = 4
CACHE_PAGES = 1500

# (image, tesseract code) -> (blocks, word confidences 0..100); replaced by a fake in tests.
Engine = Callable[[Image.Image, str], tuple[list[dict[str, Any]], list[float]]]


def tesseract_engine(img: Image.Image, code: str) -> tuple[list[dict[str, Any]], list[float]]:
    """Real engine: Tesseract via :func:`kenning_nlp.ocr.ocr_image_data`."""
    return ocr_image_data(img, code)


def data_to_blocks(data: dict[str, list[Any]], width: int, height: int) -> list[dict[str, Any]]:
    """Group Tesseract ``image_to_data`` rows into blocks with normalised bounding boxes.

    Returns blocks in Tesseract's reading order as ``{"text", "x", "y", "w", "h"}`` where the
    box is a fraction (0..1) of the page. Pure; used by the engine and by tests.
    """
    blocks: dict[int, dict[str, Any]] = {}
    for i, word in enumerate(data["text"]):
        word = str(word).strip()
        if not word or float(data["conf"][i]) < 0:
            continue
        b = blocks.setdefault(
            int(data["block_num"][i]),
            {"lines": {}, "x0": 1e9, "y0": 1e9, "x1": 0, "y1": 0},
        )
        key = (int(data["par_num"][i]), int(data["line_num"][i]))
        b["lines"].setdefault(key, []).append(word)
        left, top = int(data["left"][i]), int(data["top"][i])
        b["x0"], b["y0"] = min(b["x0"], left), min(b["y0"], top)
        b["x1"] = max(b["x1"], left + int(data["width"][i]))
        b["y1"] = max(b["y1"], top + int(data["height"][i]))
    out = []
    for _, b in sorted(blocks.items()):
        lines = [" ".join(w) for _, w in sorted(b["lines"].items())]
        out.append(
            {
                "text": "\n".join(lines),
                "x": round(b["x0"] / width, 4),
                "y": round(b["y0"] / height, 4),
                "w": round((b["x1"] - b["x0"]) / width, 4),
                "h": round((b["y1"] - b["y0"]) / height, 4),
            }
        )
    return out


def _open_image(data: bytes) -> Image.Image:
    """Open an image upload lazily.

    Raises:
        ServiceError: 413 for a decompression bomb (more pixels than ``Image.MAX_IMAGE_PIXELS``
            allows), 415 for anything that is not a supported image.
    """
    try:
        return Image.open(io.BytesIO(data))
    except Image.DecompressionBombError as e:
        raise ServiceError(413, "Image too large (too many pixels).") from e
    except (UnidentifiedImageError, OSError) as e:
        raise ServiceError(415, "Unsupported file: expected PDF, PNG, JPEG, WebP or TIFF.") from e


def iter_page_images(data: bytes, max_pages: int = MAX_COURSE_PAGES) -> Iterator[Image.Image]:
    """Yield the pages of a PDF (rendered one at a time) or the frames of an image."""
    if is_pdf(data):
        with PDFIUM_LOCK:
            pdf = _open(data)
            n = len(pdf)
        try:
            if n > max_pages:
                raise ServiceError(413, f"Too many pages (limit {max_pages}).")
            for i in range(n):
                with PDFIUM_LOCK:
                    page = pdf[i]
                    try:
                        img = page.render(scale=OCR_DPI / 72).to_pil().convert("RGB")
                    finally:
                        page.close()
                yield img
        finally:
            with PDFIUM_LOCK:
                pdf.close()
        return
    img = _open_image(data)
    frames = getattr(img, "n_frames", 1)
    if frames > MAX_FRAMES:
        raise ServiceError(413, f"Too many image frames (limit {MAX_FRAMES}).")
    for i in range(frames):
        img.seek(i)
        yield img.copy()


def count_pages(data: bytes) -> int:
    """Number of pages/frames in an upload (cheap; validates the file)."""
    if is_pdf(data):
        with PDFIUM_LOCK:
            pdf = _open(data)
            try:
                n = len(pdf)
            finally:
                pdf.close()
        if n > MAX_COURSE_PAGES:
            raise ServiceError(413, f"Too many pages (limit {MAX_COURSE_PAGES}).")
        return n
    return int(getattr(_open_image(data), "n_frames", 1))


@dataclass
class Job:
    """State of one OCR job (guarded by :attr:`lock`)."""

    id: str
    total: int
    status: str = "running"  # running | done | error
    error: str | None = None
    pages: list[dict[str, Any]] = field(default_factory=list)
    finished_at: float | None = None
    cancelled: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def view(self, after: int = 0) -> dict[str, Any]:
        """JSON-able progress snapshot with the pages at index >= ``after``."""
        with self.lock:
            return {
                "id": self.id,
                "status": self.status,
                "error": self.error,
                "done": len(self.pages),
                "total": self.total,
                "pages": self.pages[after:],
            }


class CourseOcr:
    """Starts and tracks OCR jobs; holds the per-page cache. One instance per process."""

    def __init__(self, engine: Engine = tesseract_engine, check: bool = True) -> None:
        self.engine = engine
        self.check = check
        self.jobs: dict[str, Job] = {}
        self.cache: OrderedDict[str, tuple[list[dict[str, Any]], float]] = OrderedDict()
        self.lock = threading.Lock()

    def start(self, data: bytes | list[bytes], lang: str) -> Job:
        """Validate the upload(s) and start a background job.

        Several files (photos of pages) are read in order as one book: their pages are numbered
        consecutively.

        Raises:
            ServiceError: 503 without Tesseract, 415/413/422 for bad uploads, 429 if too many
                jobs are running.
        """
        code = ensure_tesseract(lang) if self.check else "nld"
        files = data if isinstance(data, list) else [data]
        total = sum(count_pages(d) for d in files)
        if total > MAX_COURSE_PAGES:
            raise ServiceError(413, f"Too many pages (limit {MAX_COURSE_PAGES}).")
        self._purge()
        with self.lock:
            if sum(j.status == "running" for j in self.jobs.values()) >= MAX_JOBS:
                raise ServiceError(429, "Too many OCR jobs are running; wait for one to finish.")
            job = Job(id=uuid.uuid4().hex, total=total)
            self.jobs[job.id] = job
        threading.Thread(target=self._run, args=(job, files, code), daemon=True).start()
        return job

    def get(self, job_id: str) -> Job:
        """Look up a job (404 if unknown or expired)."""
        self._purge()
        job = self.jobs.get(job_id)
        if job is None:
            raise ServiceError(404, "Unknown or expired OCR job.")
        return job

    def cancel(self, job_id: str) -> None:
        """Stop a job after its current page and drop it."""
        job = self.get(job_id)
        job.cancelled = True
        with self.lock:
            self.jobs.pop(job_id, None)

    def _purge(self) -> None:
        now = time.time()
        with self.lock:
            for jid in [
                j.id
                for j in self.jobs.values()
                if j.finished_at and now - j.finished_at > JOB_TTL_SECONDS
            ]:
                del self.jobs[jid]

    def _page(self, img: Image.Image, code: str) -> tuple[list[dict[str, Any]], float]:
        key = hashlib.sha256(img.tobytes() + code.encode()).hexdigest()
        with self.lock:
            hit = self.cache.get(key)
            if hit:
                self.cache.move_to_end(key)
                return hit
        blocks, confs = self.engine(img, code)
        conf = sum(confs) / len(confs) / 100 if confs else 0.0
        result = (blocks, round(conf, 3))
        with self.lock:
            self.cache[key] = result
            while len(self.cache) > CACHE_PAGES:
                self.cache.popitem(last=False)
        return result

    def _run(self, job: Job, files: list[bytes], code: str) -> None:
        images = (img for data in files for img in iter_page_images(data))
        try:
            for n, img in enumerate(images, start=1):
                if job.cancelled:
                    return
                blocks, conf = self._page(img, code)
                page = {
                    "n": n,
                    "text": "\n\n".join(b["text"] for b in blocks),
                    "confidence": conf,
                    "blocks": blocks,
                }
                with job.lock:
                    job.pages.append(page)
            with job.lock:
                job.status = "done"
        except ServiceError as e:
            with job.lock:
                job.status, job.error = "error", e.detail
        except Exception as e:  # noqa: BLE001 - report any engine failure to the client
            with job.lock:
                job.status, job.error = "error", f"OCR failed: {e}"
        finally:
            job.finished_at = time.time()
