"""PDF text extraction and rasterisation via pypdfium2 (BSD/Apache)."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from kenning_nlp.cleanup import clean_pages
from kenning_nlp.errors import ServiceError

if TYPE_CHECKING:
    from PIL.Image import Image

# PDFium is not thread-safe, and FastAPI runs sync endpoints in a thread pool.
PDFIUM_LOCK = threading.RLock()

MIN_ALNUM_PER_PAGE = 25
"""Average alphanumeric characters per page below which a PDF is considered a scan."""
MAX_PAGES = 300
MAX_OCR_PAGES = 60
OCR_DPI = 300


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

    Returns ``{"title", "text", "pages", "needs_ocr"}``. ``needs_ocr`` is true when the PDF
    has (almost) no text layer, i.e. it is a scan and should go through ``/ocr``.

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
    return {
        "title": (meta.get("Title") or "").strip(),
        "text": clean_pages(raw_pages),
        "pages": n_pages,
        "needs_ocr": needs_ocr,
    }


def rasterize_pdf(data: bytes, dpi: int = OCR_DPI, max_pages: int = MAX_OCR_PAGES) -> list[Image]:
    """Render PDF pages to PIL images (for OCR), at most ``max_pages`` pages.

    Raises:
        ServiceError: 413 if the PDF has more than ``max_pages`` pages, 422 if unreadable.
    """
    with PDFIUM_LOCK:
        pdf = _open(data)
        try:
            if len(pdf) > max_pages:
                raise ServiceError(413, f"Too many pages for OCR (limit {max_pages}).")
            images = []
            for i in range(len(pdf)):
                page = pdf[i]
                try:
                    images.append(page.render(scale=dpi / 72).to_pil().convert("RGB"))
                finally:
                    page.close()
            return images
        finally:
            pdf.close()
