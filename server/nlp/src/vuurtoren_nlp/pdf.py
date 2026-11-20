"""PDF text extraction and rasterisation via pypdfium2 (BSD/Apache).

Each page is judged on its own (:func:`text_layer_ok`): a page whose text layer is missing,
nearly empty or not Dutch is read by OCR, the other pages keep their text layer. A text layer
is "not Dutch" when fewer than :data:`MIN_DUTCH_SHARE` of its words are Dutch words in the
server's lexicon (wordfreq, the dictionary, simplemma, two-part compounds); that catches broken
font encodings and the poor OCR layers some scanners add. Pages with fewer than
:data:`MIN_WORDS_FOR_SHARE` words are not judged by that share.
"""

from __future__ import annotations

import re
import threading
from collections.abc import Iterator
from typing import TYPE_CHECKING

from vuurtoren_nlp.cleanup import clean_pages
from vuurtoren_nlp.errors import ServiceError

if TYPE_CHECKING:
    from PIL.Image import Image

# PDFium is not thread-safe, and FastAPI runs sync endpoints in a thread pool.
PDFIUM_LOCK = threading.RLock()

MIN_ALNUM_PER_PAGE = 25
"""Average alphanumeric characters per page below which a PDF is a scan (no OCR engine)."""
MIN_TEXT_LAYER_CHARS = 40
"""A page needs at least this many letters/digits in its text layer to skip OCR."""
MIN_DUTCH_SHARE = 0.7
"""Share of a text layer's words that must be Dutch words for the page to skip OCR."""
MIN_WORDS_FOR_SHARE = 12
SHARE_SAMPLE = 300
"""Words of a page checked against the lexicon (the first ones)."""
MAX_PAGES = 300
MAX_OCR_PAGES = 60
OCR_DPI = 300
_WORD = re.compile(r"[^\W\d_]{2,}")


def dutch_share(text: str) -> tuple[float, int]:
    """Share of the words (two or more letters) of ``text`` that are Dutch, and their count."""
    from vuurtoren_nlp.ocr_review import is_known

    words = _WORD.findall(text)[:SHARE_SAMPLE]
    if not words:
        return 0.0, 0
    return sum(is_known(w, "nl") for w in words) / len(words), len(words)


def text_layer_ok(text: str) -> bool:
    """True when a page's text layer can be used as it is (see the module docstring)."""
    if sum(c.isalnum() for c in text) < MIN_TEXT_LAYER_CHARS:
        return False
    share, n = dutch_share(text)
    return n < MIN_WORDS_FOR_SHARE or share >= MIN_DUTCH_SHARE


def is_pdf(data: bytes) -> bool:
    """True if the bytes start with the PDF magic (allowing leading junk within 1 KB)."""
    return b"%PDF-" in data[:1024]


def _open(data: bytes):  # noqa: ANN202 (pypdfium2 type is optional at import time)
    import pypdfium2 as pdfium

    try:
        return pdfium.PdfDocument(data)
    except pdfium.PdfiumError as e:
        msg = str(e).lower()
        if "password" in msg:
            raise ServiceError(422, "The PDF is password-protected.") from e
        raise ServiceError(422, "The file could not be read as a PDF.") from e


def extract_pdf(data: bytes) -> dict[str, object]:
    """Extract cleaned text from a text-based PDF.

    Returns ``{"title", "text", "pages", "needs_ocr"}``. ``needs_ocr`` is true when a page has
    no usable text layer (:func:`text_layer_ok`) and an OCR engine is installed: then ``/ocr``
    reads those pages and keeps the text layer of the others. Without an OCR engine it is true
    only for a scan (almost no text at all), and ``text`` holds whatever the text layer has.

    Raises:
        ServiceError: 415 if not a PDF, 422 if unreadable/encrypted, 413 if too many pages.
    """
    if not is_pdf(data):
        raise ServiceError(415, "The file is not a PDF.")
    with PDFIUM_LOCK:
        pdf = _open(data)
        try:
            n_pages = len(pdf)
            if n_pages > MAX_PAGES:
                raise ServiceError(413, f"Too many pages (limit {MAX_PAGES}).")
            raw_pages: list[str] = []
            for i in range(n_pages):
                page = pdf[i]
                try:
                    textpage = page.get_textpage()
                    raw_pages.append(textpage.get_text_range())
                    textpage.close()
                finally:
                    page.close()
            meta = pdf.get_metadata_dict()
        finally:
            pdf.close()
    alnum = sum(c.isalnum() for p in raw_pages for c in p)
    needs_ocr = n_pages == 0 or alnum < MIN_ALNUM_PER_PAGE * n_pages
    if not needs_ocr and _ocr_installed():
        needs_ocr = not all(text_layer_ok(p) for p in raw_pages)
    return {
        "title": (meta.get("Title") or "").strip(),
        "text": clean_pages(raw_pages),
        "pages": n_pages,
        "needs_ocr": needs_ocr,
    }


def _ocr_installed() -> bool:
    from vuurtoren_nlp.ocr import ocr_engine_name

    return ocr_engine_name() is not None


def iter_pdf_pages(
    data: bytes,
    dpi: int = OCR_DPI,
    max_ocr_pages: int = MAX_OCR_PAGES,
    preview_side: int = 0,
) -> Iterator[tuple[str | None, Image | None]]:
    """The pages of a PDF for OCR, in order, as ``(text, image)``.

    A page with a usable text layer (:func:`text_layer_ok`) gives its text, and with
    ``preview_side`` also a picture of the page about that many pixels on its long side; any
    other page gives ``(None, page rendered at dpi)``. Pages are rendered one at a time, when
    their turn comes.

    Raises:
        ServiceError: 413 for more than :data:`MAX_PAGES` pages or more than ``max_ocr_pages``
            pages to OCR, 422 if unreadable.
    """
    with PDFIUM_LOCK:
        pdf = _open(data)
    try:
        with PDFIUM_LOCK:
            n = len(pdf)
            if n > MAX_PAGES:
                raise ServiceError(413, f"Too many pages (limit {MAX_PAGES}).")
            texts = []
            for i in range(n):
                page = pdf[i]
                try:
                    tp = page.get_textpage()
                    texts.append(tp.get_text_range())
                    tp.close()
                finally:
                    page.close()
        usable = [text_layer_ok(t) for t in texts]
        if usable.count(False) > max_ocr_pages:
            raise ServiceError(413, f"Too many pages for OCR (limit {max_ocr_pages}).")
        for i, text in enumerate(texts):
            if usable[i] and not preview_side:
                yield text, None
                continue
            with PDFIUM_LOCK:
                page = pdf[i]
                try:
                    scale = dpi / 72
                    if usable[i]:
                        scale = preview_side / max(*page.get_size(), 1.0)
                    img = page.render(scale=scale).to_pil().convert("RGB")
                finally:
                    page.close()
            yield (text if usable[i] else None), img
    finally:
        with PDFIUM_LOCK:
            pdf.close()


THUMB_WIDTH = 600
"""Width of a cover thumbnail; the height is 5/4 of it (the Library's 4:5 covers)."""


def cover_thumbnail(data: bytes) -> bytes:
    """A 4:5 WebP cover (600x750) of the first page of a PDF, or of an image.

    The page is scaled to cover the frame and cropped from the top (a page's title is there),
    an image is cropped around its centre.

    Raises:
        ServiceError: 415 if the bytes are neither a PDF nor an image, 422 if unreadable.
    """
    import io

    from PIL import Image, ImageOps, UnidentifiedImageError

    w, h = THUMB_WIDTH, THUMB_WIDTH * 5 // 4
    if is_pdf(data):
        with PDFIUM_LOCK:
            pdf = _open(data)
            try:
                if len(pdf) == 0:
                    raise ServiceError(422, "The PDF has no pages.")
                page = pdf[0]
                try:
                    pw, _ = page.get_size()
                    img = page.render(scale=max(w / max(pw, 1.0), 0.1)).to_pil().convert("RGB")
                finally:
                    page.close()
            finally:
                pdf.close()
        centering = (0.5, 0.0)
    else:
        try:
            src = Image.open(io.BytesIO(data))
            src.draft("RGB", (w * 2, h * 2))
            img = ImageOps.exif_transpose(src).convert("RGB")
        except (UnidentifiedImageError, OSError) as e:
            raise ServiceError(415, "The file is not a PDF or an image.") from e
        centering = (0.5, 0.5)
    thumb = ImageOps.fit(img, (w, h), Image.Resampling.LANCZOS, centering=centering)
    out = io.BytesIO()
    thumb.save(out, "WEBP", quality=80, method=4)
    return out.getvalue()
