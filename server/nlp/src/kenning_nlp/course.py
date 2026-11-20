"""Background OCR jobs for course import (a whole book, page by page, with progress).

``POST /course/ocr`` accepts a PDF or image upload and starts a job; ``GET /course/ocr/{id}``
reports progress and returns the pages finished so far (``?after=N`` returns only pages with
index >= N, so a client can poll cheaply). The upload and the rendered pages live only in memory
for the job's lifetime; finished jobs are dropped after :data:`JOB_TTL_SECONDS`. Recognised page
text is cached by file hash and page index (in memory, and in ``$KENNING_COURSE_CACHE_DIR`` when
set) so that re-importing the same book, or restarting a job, is fast. PDF pages with a usable
text layer (:func:`kenning_nlp.pdf.text_layer_ok`) and EPUB chapters skip OCR. Scanned pages are
recognised by several workers at once.

Each page is returned as layout *blocks* (OCR blocks with a normalised bounding box and the
text, lines joined by newlines) plus the full page text. Interpretation (headers, exercises,
units) is done by the client's pure course logic; this module only does I/O.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import threading
import time
import uuid
import zipfile
from collections import OrderedDict
from collections.abc import Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

from kenning_nlp import rapid
from kenning_nlp.errors import ServiceError
from kenning_nlp.ocr import (
    MAX_FRAMES,
    RAPID_PREFIX,
    ensure_engine,
    lang_of_code,
    ocr_image_data,
)
from kenning_nlp.ocr_review import COURSE_PREVIEW_LONG_SIDE, OcrWord, find_flags, preview_webp
from kenning_nlp.pdf import OCR_DPI, PDFIUM_LOCK, _open, is_pdf, text_layer_ok

MAX_COURSE_PAGES = 400
COURSE_MAX_UPLOAD_BYTES = 200 * 1024 * 1024
"""A scanned book can be large; course uploads are allowed up to 200 MB."""
JOB_TTL_SECONDS = 3600
MAX_JOBS = 4
CACHE_PAGES = 1500

# (image, engine code) -> (blocks, word confidences 0..100[, words with boxes[, cleaned page
# image]]); the words are optional (a fake engine in tests may leave them out; then the page has
# no review flags), the image too (then the preview shows the page as uploaded).
Engine = Callable[[Image.Image, str], tuple[Any, ...]]
# (blocks, mean confidence 0..1, review flags or None)
PageResult = tuple[list[dict[str, Any]], float, list[dict[str, Any]] | None]


def ocr_engine(img: Image.Image, code: str) -> tuple[Any, ...]:
    """Real engine: clean-up plus RapidOCR, via :func:`kenning_nlp.ocr.ocr_image_data`."""
    return ocr_image_data(img, code)


def data_to_blocks(data: dict[str, list[Any]], width: int, height: int) -> list[dict[str, Any]]:
    """Group ``image_to_data``-shaped rows into blocks with normalised bounding boxes.

    Returns blocks in reading order as ``{"text", "x", "y", "w", "h"}`` where the
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


@dataclass
class PageSource:
    """One page of an upload: either text that needs no OCR, or an image rendered on demand.

    ``key`` is stable for the same file and page (file hash + index), so the cache can be hit
    without rendering the page at all.
    """

    key: str
    text: str | None = None
    render: Callable[[], Image.Image] | None = None


def text_blocks(text: str) -> list[dict[str, Any]]:
    """Blocks of a text-layer page: paragraphs (blank-line separated), without real boxes."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if p.strip()]
    if len(paras) <= 1:
        # PDF text layers rarely contain blank lines: then every line is its own paragraph.
        paras = [ln.strip() for ln in text.replace("\r\n", "\n").split("\n") if ln.strip()]
    return [{"text": p, "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0} for p in paras]


def _pdf_sources(data: bytes, prefix: str, max_pages: int) -> Iterator[PageSource]:
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
                    tp = page.get_textpage()
                    text = tp.get_text_range()
                    tp.close()
                finally:
                    page.close()
            if text_layer_ok(text):
                yield PageSource(key=f"{prefix}-{i}-text", text=text)
                continue

            def render(i: int = i) -> Image.Image:
                with PDFIUM_LOCK:
                    pg = pdf[i]
                    try:
                        return pg.render(scale=OCR_DPI / 72).to_pil().convert("RGB")
                    finally:
                        pg.close()

            yield PageSource(key=f"{prefix}-{i}-{OCR_DPI}", render=render)
    finally:
        with PDFIUM_LOCK:
            pdf.close()


def iter_page_sources(data: bytes, max_pages: int = MAX_COURSE_PAGES) -> Iterator[PageSource]:
    """Yield the pages of a PDF, an EPUB (chapters) or an image (frames), in reading order."""
    prefix = hashlib.sha256(data).hexdigest()[:32]
    if is_pdf(data):
        yield from _pdf_sources(data, prefix, max_pages)
        return
    if is_epub(data):
        for i, text in enumerate(epub_chapters(data)[:max_pages]):
            yield PageSource(key=f"{prefix}-{i}-epub", text=text)
        return
    img = _open_image(data)
    frames = getattr(img, "n_frames", 1)
    if frames > MAX_FRAMES:
        raise ServiceError(413, f"Too many image frames (limit {MAX_FRAMES}).")
    for i in range(frames):

        def render(i: int = i) -> Image.Image:
            img.seek(i)
            return img.copy()

        yield PageSource(key=f"{prefix}-{i}-img", render=render)


# --------------------------------------------------------------------------- EPUB


def is_epub(data: bytes) -> bool:
    """True for a ZIP whose ``mimetype`` entry says EPUB."""
    if not data.startswith(b"PK"):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return z.read("mimetype").strip() == b"application/epub+zip"
    except (zipfile.BadZipFile, KeyError):
        return False


class _TextOfHtml(HTMLParser):
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "td"}
    SKIP = {"script", "style", "head", "nav"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)

    def text(self) -> str:
        raw = "".join(self.parts)
        lines = [re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in raw.split("\n")]
        return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def html_text(html: str) -> str:
    """Plain text of an (X)HTML document, one line per block element."""
    p = _TextOfHtml()
    p.feed(html)
    return p.text()


def epub_chapters(data: bytes) -> list[str]:
    """Text of each spine document of an EPUB (empty documents dropped).

    Raises:
        ServiceError: 422 when the EPUB is malformed.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            container = z.read("META-INF/container.xml").decode("utf-8", "replace")
            m = re.search(r'full-path="([^"]+)"', container)
            if not m:
                raise ServiceError(422, "The EPUB has no package document.")
            opf_path = m.group(1)
            opf = z.read(opf_path).decode("utf-8", "replace")
            base = opf_path.rsplit("/", 1)[0] + "/" if "/" in opf_path else ""
            items = {
                mm.group("id"): mm.group("href")
                for mm in re.finditer(
                    r'<item\b(?=[^>]*\bid="(?P<id>[^"]+)")(?=[^>]*\bhref="(?P<href>[^"]+)")[^>]*>',
                    opf,
                )
            }
            spine = re.findall(r'<itemref\b[^>]*\bidref="([^"]+)"', opf)
            out = []
            for idref in spine:
                href = items.get(idref)
                if not href:
                    continue
                try:
                    html = z.read(base + href).decode("utf-8", "replace")
                except KeyError:
                    continue
                text = html_text(html)
                if text.strip():
                    out.append(text)
            return out
    except (zipfile.BadZipFile, KeyError) as e:
        raise ServiceError(422, "The EPUB could not be read.") from e


def count_pages(data: bytes) -> int:
    """Number of pages/frames/chapters in an upload (cheap; validates the file)."""
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
    if is_epub(data):
        return min(len(epub_chapters(data)), MAX_COURSE_PAGES)
    return int(getattr(_open_image(data), "n_frames", 1))


@dataclass
class Job:
    """State of one OCR job (guarded by :attr:`lock`)."""

    id: str
    total: int
    status: str = "running"  # running | done | error
    error: str | None = None
    pages: list[dict[str, Any]] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    cancelled: bool = False
    cached: int = 0
    previews: dict[int, bytes] = field(default_factory=dict)
    """Page number -> downscaled WebP of pages with review flags (served while the job lives)."""
    lock: threading.Lock = field(default_factory=threading.Lock)

    def view(self, after: int = 0) -> dict[str, Any]:
        """JSON-able progress snapshot with the pages at index >= ``after``.

        ``eta`` is the estimated seconds left (from the pace of the pages OCR'd so far, cache
        hits excluded), or null before there is a pace.
        """
        with self.lock:
            done = len(self.pages)
            worked = done - self.cached
            elapsed = (self.finished_at or time.time()) - self.started_at
            eta = (
                round(elapsed / worked * (self.total - done))
                if self.status == "running" and worked > 0
                else None
            )
            return {
                "id": self.id,
                "status": self.status,
                "error": self.error,
                "done": done,
                "total": self.total,
                "cached": self.cached,
                "elapsed": round(elapsed, 1),
                "eta": eta,
                "pages": self.pages[after:],
            }


def default_workers() -> int:
    """Pages read in parallel: ``$KENNING_OCR_WORKERS`` or half the CPUs (1..6)."""
    env = os.environ.get("KENNING_OCR_WORKERS")
    if env and env.isdigit() and int(env) > 0:
        return int(env)
    return max(1, min(6, (os.cpu_count() or 2) // 2))


def default_cache_dir() -> Path | None:
    """Disk cache of recognised pages: ``$KENNING_COURSE_CACHE_DIR`` (unset = memory only)."""
    env = os.environ.get("KENNING_COURSE_CACHE_DIR")
    return Path(env) if env else None


class CourseOcr:
    """Starts and tracks OCR jobs; holds the per-page cache. One instance per process.

    Pages are rendered one at a time (PDFium is not thread-safe) and recognised by up to
    ``workers`` threads in parallel; finished pages are published in page order.
    The cache (memory, plus an optional directory) is keyed by file hash and page index, so a
    re-import of the same book, or a job restarted after the server restarted, skips both
    rendering and OCR.
    """

    def __init__(
        self,
        engine: Engine = ocr_engine,
        check: bool = True,
        workers: int | None = None,
        cache_dir: Path | None | bool = True,
    ) -> None:
        self.engine = engine
        self.check = check
        self.workers = workers or default_workers()
        self.cache_dir = default_cache_dir() if cache_dir is True else (cache_dir or None)
        if self.workers > 1:
            # The engines' own threads would oversubscribe the CPUs next to our workers.
            os.environ.setdefault("OMP_THREAD_LIMIT", "1")
        self.engine_threads = max(1, (os.cpu_count() or 2) // self.workers)
        self.jobs: dict[str, Job] = {}
        self.cache: OrderedDict[str, PageResult] = OrderedDict()
        self.lock = threading.Lock()

    def start(self, data: bytes | list[bytes], lang: str) -> Job:
        """Validate the upload(s) and start a background job.

        Several files (photos of pages) are read in order as one book: their pages are numbered
        consecutively.

        Raises:
            ServiceError: 503 without an OCR engine, 415/413/422 for bad uploads, 429 if too
                many jobs are running.
        """
        files = data if isinstance(data, list) else [data]
        total = sum(count_pages(d) for d in files)
        if total > MAX_COURSE_PAGES:
            raise ServiceError(413, f"Too many pages (limit {MAX_COURSE_PAGES}).")
        code = RAPID_PREFIX + lang
        missing: ServiceError | None = None
        if self.check:
            try:
                code = ensure_engine(lang)
            except ServiceError as e:
                # Text-layer PDFs and EPUBs need no OCR; a scanned page will report this error.
                missing = e
        self._purge()
        with self.lock:
            if sum(j.status == "running" for j in self.jobs.values()) >= MAX_JOBS:
                raise ServiceError(429, "Too many OCR jobs are running; wait for one to finish.")
            job = Job(id=uuid.uuid4().hex, total=total)
            self.jobs[job.id] = job
        threading.Thread(target=self._run, args=(job, files, code, missing), daemon=True).start()
        return job

    def get(self, job_id: str) -> Job:
        """Look up a job (404 if unknown or expired)."""
        self._purge()
        job = self.jobs.get(job_id)
        if job is None:
            raise ServiceError(404, "Unknown or expired OCR job.")
        return job

    def preview(self, job_id: str, n: int) -> bytes:
        """The WebP preview of page ``n`` of a job (404 when the page has none)."""
        job = self.get(job_id)
        with job.lock:
            img = job.previews.get(n)
        if img is None:
            raise ServiceError(404, "No image of this page.")
        return img

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

    # ------------------------------------------------------------------ cache

    def _cache_path(self, key: str) -> Path | None:
        if not self.cache_dir or not re.fullmatch(r"[0-9a-z-]+", key):
            return None
        return self.cache_dir / f"{key}.json"

    def _cached(self, key: str) -> PageResult | None:
        """A cached page: memory first, then the disk cache (with its preview image, if any)."""
        with self.lock:
            hit = self.cache.get(key)
            if hit:
                self.cache.move_to_end(key)
                return hit
        path = self._cache_path(key)
        if path and path.is_file():
            try:
                raw = json.loads(path.read_text("utf-8"))
                flags = raw.get("flags")
                hit = (raw["blocks"], float(raw["confidence"]), flags if flags else None)
            except (OSError, ValueError, KeyError, TypeError, AttributeError):
                return None
            self._remember(key, hit, disk=False)
            return hit
        return None

    def _cached_preview(self, key: str) -> bytes | None:
        path = self._cache_path(key)
        if not path:
            return None
        try:
            return path.with_suffix(".webp").read_bytes()
        except OSError:
            return None

    def _remember(
        self, key: str, result: PageResult, disk: bool, preview: bytes | None = None
    ) -> None:
        with self.lock:
            self.cache[key] = result
            while len(self.cache) > CACHE_PAGES:
                self.cache.popitem(last=False)
        path = self._cache_path(key) if disk else None
        if path:
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                if preview:
                    path.with_suffix(".webp").write_bytes(preview)
                tmp = path.with_suffix(".tmp")
                body = {"blocks": result[0], "confidence": result[1], "flags": result[2]}
                tmp.write_text(json.dumps(body), "utf-8")
                tmp.replace(path)
            except OSError:
                pass  # the cache is an optimisation only

    def _ocr(self, img: Image.Image, code: str) -> tuple[PageResult, bytes | None]:
        """Recognise one page; flag doubtful words and keep a small preview of a flagged page."""
        rapid.limit_threads(self.engine_threads)
        blocks, confs, *rest = self.engine(img, code)
        conf = round(sum(confs) / len(confs) / 100 if confs else 0.0, 3)
        words: list[OcrWord] = rest[0] if rest else []
        page_img: Image.Image = rest[1] if len(rest) > 1 else img
        flags = None
        preview = None
        if words:
            text = "\n\n".join(b["text"] for b in blocks)
            flags = find_flags(text, words, lang_of_code(code)) or None
            if flags:
                preview = preview_webp(page_img, COURSE_PREVIEW_LONG_SIDE, quality=55)
        return (blocks, conf, flags), preview

    # ------------------------------------------------------------------ run

    def _run(
        self, job: Job, files: list[bytes], code: str, missing: ServiceError | None = None
    ) -> None:
        sources = (src for data in files for src in iter_page_sources(data))
        pending: dict[int, Future[tuple[PageResult, bytes | None]] | PageResult] = {}
        keys: dict[int, str] = {}
        next_out = 1

        def publish(n: int, result: PageResult, preview: bytes | None) -> None:
            blocks, conf, flags = result
            page: dict[str, Any] = {
                "n": n,
                "text": "\n\n".join(b["text"] for b in blocks),
                "confidence": conf,
                "blocks": blocks,
            }
            if flags:
                # Offsets in the flags point into ``text``; ``image`` says whether
                # ``GET /course/ocr/{id}/page/{n}/image`` has a picture of the page.
                page["review"] = {"flags": flags, "image": preview is not None}
            with job.lock:
                if preview is not None:
                    job.previews[n] = preview
                job.pages.append(page)

        def flush(block: bool) -> None:
            nonlocal next_out
            while next_out in pending:
                item = pending[next_out]
                if isinstance(item, Future):
                    if not block and not item.done():
                        return
                    result, preview = item.result()
                    self._remember(keys[next_out], result, disk=True, preview=preview)
                else:
                    result = item
                    preview = self._cached_preview(keys[next_out]) if result[2] else None
                del pending[next_out]
                publish(next_out, result, preview)
                next_out += 1

        try:
            with ThreadPoolExecutor(max_workers=self.workers) as pool:
                for n, src in enumerate(sources, start=1):
                    if job.cancelled:
                        return
                    keys[n] = f"{src.key}-{code}"
                    hit = self._cached(keys[n])
                    if hit is not None:
                        with job.lock:
                            job.cached += 1
                        pending[n] = hit
                    elif src.text is not None:
                        result = (text_blocks(src.text), 1.0, None)
                        self._remember(keys[n], result, disk=False)
                        with job.lock:
                            job.cached += 1
                        pending[n] = result
                    else:
                        assert src.render is not None
                        if missing is not None:
                            raise missing
                        pending[n] = pool.submit(self._ocr, src.render(), code)
                    flush(block=False)
                    # Bound memory: at most two rendered pages per worker in flight.
                    while sum(isinstance(v, Future) for v in pending.values()) >= 2 * self.workers:
                        flush(block=True)
                flush(block=True)
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
