"""OCR of photos and scanned pages: page clean-up, then RapidOCR or Tesseract.

Every page first goes through :func:`kenning_nlp.straighten.straighten_page` (page found in a
photo and flattened, deskewed, dewarped; flat scans pass unchanged). Then one of two engines
reads it:

* **RapidOCR** (:mod:`kenning_nlp.rapid`, PaddleOCR models on ONNX Runtime), the main engine,
  for the languages its bundled model reads;
* **Tesseract** (via pytesseract), when RapidOCR is not installed or for a language it does not
  read (Ukrainian). Page segmentation is PSM 3 (fully automatic, detects columns), or
  ``KENNING_OCR_PSM``.

``KENNING_OCR_ENGINE`` (``auto``, ``rapidocr`` or ``tesseract``) forces one engine. Both engines
produce rows shaped like Tesseract's ``image_to_data``, so the text, layout blocks, word boxes
and review flags are built the same way.

An *engine code* names the engine and language of a request: ``rapidocr-nl`` for RapidOCR, the
Tesseract traineddata name (``nld``) for Tesseract. Course import keys its page cache by it.
"""

from __future__ import annotations

import io
import os
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from kenning_nlp import rapid
from kenning_nlp.cleanup import clean_pages
from kenning_nlp.errors import ServiceError
from kenning_nlp.ocr_review import (
    PREVIEW_LONG_SIDE,
    OcrWord,
    data_url,
    find_flags,
    page_words,
    preview_webp,
)
from kenning_nlp.pdf import is_pdf, iter_pdf_pages
from kenning_nlp.straighten import straighten_page

# Public language code -> Tesseract traineddata name.
TESSERACT_LANGS = {
    "nl": "nld",
    "uk": "ukr",
    "en": "eng",
    "de": "deu",
    "fr": "fra",
    "es": "spa",
    "it": "ita",
    "pt": "por",
    "sv": "swe",
    "da": "dan",
    "pl": "pol",
}
MIN_LONG_SIDE = 2000
"""Images whose longer side is below this (pixels) are upscaled before OCR."""
MAX_UPSCALE = 3.0
MAX_PIXELS = 120_000_000
MAX_FRAMES = 60
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

INSTALL_HINT = (
    "Tesseract OCR is not available on the server. Install it (Debian/Ubuntu: "
    "`apt install tesseract-ocr tesseract-ocr-nld tesseract-ocr-ukr`) or use the standard "
    "kenning-nlp Docker image (the `-slim` variant has no OCR)."
)
RAPID_PREFIX = "rapidocr-"
RAPID_LOW_CONF = 70.0
"""RapidOCR word score (0-100) below which a known word is still flagged for review. Its scores
separate right from wrong words weakly; at 70 about 1 % of correct words get a flag."""


def engine_choice() -> str:
    """``$KENNING_OCR_ENGINE``: ``auto`` (default), ``rapidocr`` or ``tesseract``."""
    choice = os.environ.get("KENNING_OCR_ENGINE", "auto").strip().lower()
    return choice if choice in ("rapidocr", "tesseract") else "auto"


def ocr_engine_name() -> str | None:
    """The engine Dutch pages are read with (``rapidocr`` or ``tesseract``), or None when no
    OCR engine is installed. Cheap: nothing is loaded."""
    import shutil

    choice = engine_choice()
    if choice != "tesseract" and rapid.available():
        return "rapidocr"
    if choice != "rapidocr" and shutil.which("tesseract") is not None:
        return "tesseract"
    return None


def ensure_engine(lang: str) -> str:
    """Pick the engine for ``lang`` and return its engine code (see the module docstring).

    RapidOCR when it is installed and reads ``lang``, else Tesseract.

    Raises:
        ServiceError: 503 with install guidance when no engine can read ``lang``.
    """
    choice = engine_choice()
    if choice != "tesseract" and lang in rapid.LANGS and rapid.available():
        return RAPID_PREFIX + lang
    if choice == "rapidocr" and lang in rapid.LANGS:
        raise ServiceError(503, "RapidOCR is not installed on the server (pip install rapidocr).")
    return ensure_tesseract(lang)


def lang_of_code(code: str) -> str:
    """The language of an engine code (``rapidocr-nl`` -> ``nl``, ``nld`` -> ``nl``)."""
    if code.startswith(RAPID_PREFIX):
        return code[len(RAPID_PREFIX) :]
    return {v: k for k, v in TESSERACT_LANGS.items()}.get(code, "nl")


def low_conf(code: str) -> float:
    """The word confidence below which review flags a known word, on the engine's scale."""
    from kenning_nlp.ocr_review import LOW_CONF

    return RAPID_LOW_CONF if code.startswith(RAPID_PREFIX) else LOW_CONF


def ensure_tesseract(lang: str) -> str:
    """Check that Tesseract and the traineddata for ``lang`` exist; return the Tesseract code.

    Raises:
        ServiceError: 503 with install guidance if the binary or language data is missing.
    """
    import pytesseract

    code = TESSERACT_LANGS[lang]
    try:
        pytesseract.get_tesseract_version()
    except pytesseract.TesseractNotFoundError as e:
        raise ServiceError(503, INSTALL_HINT) from e
    if code not in pytesseract.get_languages(config=""):
        raise ServiceError(
            503, f"Tesseract language data '{code}' is missing (apt install tesseract-ocr-{code})."
        )
    return code


def preprocess(img: Image.Image) -> Image.Image:
    """Grayscale, upscale small images, and stretch contrast (helps phone photos and thumbnails)."""
    img = ImageOps.exif_transpose(img) or img
    gray = ImageOps.grayscale(img)
    long_side = max(gray.size)
    if long_side < MIN_LONG_SIDE:
        factor = min(MAX_UPSCALE, MIN_LONG_SIDE / long_side)
        gray = gray.resize(
            (round(gray.width * factor), round(gray.height * factor)), Image.Resampling.LANCZOS
        )
    return ImageOps.autocontrast(gray, cutoff=1)


def words_to_text(data: dict[str, list[Any]]) -> tuple[str, list[float]]:
    """Rebuild text from Tesseract ``image_to_data`` output (pure; easy to test).

    Lines are grouped by (block, paragraph, line); blocks/paragraphs are separated by blank
    lines, which keeps columns in reading order. Returns ``(text, word_confidences)`` with
    confidences on Tesseract's 0-100 scale (negative = non-word rows, skipped).
    """
    paragraphs: dict[tuple[int, int], dict[int, list[str]]] = {}
    confs: list[float] = []
    for i, word in enumerate(data["text"]):
        word = str(word).strip()
        conf = float(data["conf"][i])
        if not word or conf < 0:
            continue
        confs.append(conf)
        key = (int(data["block_num"][i]), int(data["par_num"][i]))
        paragraphs.setdefault(key, {}).setdefault(int(data["line_num"][i]), []).append(word)
    blocks = [
        "\n".join(" ".join(words) for _, words in sorted(lines.items()))
        for _, lines in sorted(paragraphs.items())
    ]
    return "\n\n".join(blocks), confs


@dataclass
class PageRows:
    """One recognised page: Tesseract-shaped rows, the size their pixel boxes refer to, and
    the cleaned page image (what review previews show, so the boxes line up)."""

    data: dict[str, list[Any]]
    width: int
    height: int
    image: Image.Image


def tesseract_data(img: Image.Image, code: str) -> tuple[dict[str, list[Any]], int, int]:
    """Tesseract ``image_to_data`` rows of one image (preprocessed), plus the size they use."""
    import pytesseract

    psm = int(os.environ.get("KENNING_OCR_PSM", "3"))
    prepared = preprocess(img)
    data = pytesseract.image_to_data(
        prepared,
        lang=code,
        config=f"--psm {psm}",
        output_type=pytesseract.Output.DICT,
    )
    return data, prepared.width, prepared.height


def recognize(img: Image.Image, code: str, clean: bool = True) -> PageRows:
    """Clean up one page (unless ``clean`` is false) and read it with the engine of ``code``."""
    img = ImageOps.exif_transpose(img) or img
    if clean:
        img = straighten_page(img).image
    if code.startswith(RAPID_PREFIX):
        return PageRows(rapid.recognize(img, lang_of_code(code)), img.width, img.height, img)
    data, width, height = tesseract_data(img, code)
    return PageRows(data, width, height, img)


def ocr_image(img: Image.Image, code: str) -> tuple[str, list[float]]:
    """OCR one image; returns (page text, word confidences)."""
    return words_to_text(recognize(img, code).data)


def ocr_image_data(
    img: Image.Image, code: str
) -> tuple[list[dict[str, object]], list[float], list[OcrWord], Image.Image]:
    """OCR one image into layout blocks (text + normalised bounding box), word confidences,
    the words with their boxes (for review flags, :mod:`kenning_nlp.ocr_review`) and the
    cleaned page image the boxes refer to."""
    from kenning_nlp.course import data_to_blocks

    page = recognize(img, code)
    data = page.data
    confs = [
        float(c)
        for t, c in zip(data["text"], data["conf"], strict=True)
        if str(t).strip() and float(c) >= 0
    ]
    blocks = data_to_blocks(data, page.width, page.height)
    return blocks, confs, page_words(data, page.width, page.height, 1), page.image


def load_images(data: bytes) -> list[Image.Image]:
    """Decode an image upload (all its frames) into PIL images.

    Raises:
        ServiceError: 415 if the file is not a supported image, 413 if too big.
    """
    try:
        img = Image.open(io.BytesIO(data))
        n_frames = getattr(img, "n_frames", 1)
        if n_frames > MAX_FRAMES:
            raise ServiceError(413, f"Too many image frames (limit {MAX_FRAMES}).")
        frames = []
        for i in range(n_frames):
            img.seek(i)
            frames.append(img.copy())
        return frames
    except Image.DecompressionBombError as e:
        raise ServiceError(413, "Image too large (too many pixels).") from e
    except (UnidentifiedImageError, OSError) as e:
        raise ServiceError(415, "Unsupported file: expected PDF, PNG, JPEG, WebP or TIFF.") from e


def iter_pages(
    data: bytes, previews: bool = False
) -> Iterator[tuple[str | None, Image.Image | None]]:
    """The pages of an upload as ``(text layer, image)``: PDF pages via
    :func:`kenning_nlp.pdf.iter_pdf_pages` (text layer kept where usable), image frames as
    ``(None, frame)``."""
    if is_pdf(data):
        yield from iter_pdf_pages(data, preview_side=PREVIEW_LONG_SIDE if previews else 0)
        return
    for frame in load_images(data):
        yield None, frame


def run_ocr(data: bytes, lang: str, review: bool = False) -> dict[str, object]:
    """OCR an image/PDF upload. Returns ``{"text", "confidence", "pages"}``.

    PDF pages with a usable text layer keep it (:func:`kenning_nlp.pdf.text_layer_ok`); the
    others are recognised. ``confidence`` is the mean word confidence of the recognised words
    in 0..1 (1 when every page had a text layer, 0 if no words were found). The text is
    cleaned with :func:`kenning_nlp.cleanup.clean_pages` (de-hyphenation, re-flow, headers).

    With ``review`` the result also has ``"review": {"pages": [...], "flags": [...]}``: per page
    its mean confidence, a downscaled image (WebP data URL) and its size, and the words of the
    cleaned text that may be misread (:func:`kenning_nlp.ocr_review.find_flags`). Images and
    word boxes show the cleaned page (:mod:`kenning_nlp.straighten`).
    """
    code = ensure_engine(lang)
    page_texts: list[str] = []
    all_confs: list[float] = []
    words: list[OcrWord] = []
    pages: list[dict[str, object]] = []
    layer_only = True
    for n, (layer, img) in enumerate(iter_pages(data, previews=review), start=1):
        if layer is not None:
            page_texts.append(layer)
            confs: list[float] = []
            shown = img
            page_conf = 1.0
        else:
            assert img is not None
            layer_only = False
            page = recognize(img, code)
            text, confs = words_to_text(page.data)
            page_texts.append(text)
            all_confs += confs
            shown = page.image
            page_conf = round(sum(confs) / len(confs) / 100, 3) if confs else 0.0
            if review:
                words += page_words(page.data, page.width, page.height, n)
        if review and shown is not None:
            preview = preview_webp(shown)
            pw, ph = _webp_size(preview)
            pages.append(
                {
                    "n": n,
                    "confidence": page_conf,
                    "image": data_url(preview),
                    "width": pw,
                    "height": ph,
                }
            )
    if all_confs:
        confidence = sum(all_confs) / len(all_confs) / 100
    else:
        confidence = 1.0 if layer_only and any(t.strip() for t in page_texts) else 0.0
    text = clean_pages(page_texts)
    out: dict[str, object] = {
        "text": text,
        "confidence": round(confidence, 3),
        "pages": len(page_texts),
    }
    if review:
        out["review"] = {
            "pages": pages,
            "flags": find_flags(text, words, lang, low_conf=low_conf(code)),
        }
    return out


def _webp_size(webp: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(webp)) as im:
        return im.size
