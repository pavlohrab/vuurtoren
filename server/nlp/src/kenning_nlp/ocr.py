"""OCR with Tesseract (via pytesseract) for scanned journal pages and photos.

Page segmentation defaults to PSM 3 (fully automatic, detects multiple columns) and can be
overridden with ``KENNING_OCR_PSM`` (e.g. ``1`` when the OSD traineddata is installed).
"""

from __future__ import annotations

import io
import os
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from kenning_nlp.cleanup import clean_pages
from kenning_nlp.errors import ServiceError
from kenning_nlp.pdf import is_pdf, rasterize_pdf

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


def ocr_image(img: Image.Image, code: str) -> tuple[str, list[float]]:
    """OCR one image; returns (page text, word confidences)."""
    import pytesseract

    psm = int(os.environ.get("KENNING_OCR_PSM", "3"))
    data = pytesseract.image_to_data(
        preprocess(img),
        lang=code,
        config=f"--psm {psm}",
        output_type=pytesseract.Output.DICT,
    )
    return words_to_text(data)


def ocr_image_data(img: Image.Image, code: str) -> tuple[list[dict[str, object]], list[float]]:
    """OCR one image into layout blocks (text + normalised bounding box) and word confidences."""
    import pytesseract

    from kenning_nlp.course import data_to_blocks

    psm = int(os.environ.get("KENNING_OCR_PSM", "3"))
    prepared = preprocess(img)
    data = pytesseract.image_to_data(
        prepared, lang=code, config=f"--psm {psm}", output_type=pytesseract.Output.DICT
    )
    confs = [
        float(c)
        for t, c in zip(data["text"], data["conf"], strict=True)
        if str(t).strip() and float(c) >= 0
    ]
    return data_to_blocks(data, *prepared.size), confs


def load_images(data: bytes) -> list[Image.Image]:
    """Decode an upload (PDF pages or image frames) into PIL images.

    Raises:
        ServiceError: 415 if the file is neither a PDF nor a supported image, 413 if too big.
    """
    if is_pdf(data):
        return rasterize_pdf(data)
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


def run_ocr(data: bytes, lang: str) -> dict[str, object]:
    """OCR an image/PDF upload. Returns ``{"text", "confidence", "pages"}``.

    ``confidence`` is the mean word confidence in 0..1 (0 if no words were found). The text is
    cleaned with :func:`kenning_nlp.cleanup.clean_pages` (de-hyphenation, re-flow, headers).
    """
    code = ensure_tesseract(lang)
    images = load_images(data)
    page_texts: list[str] = []
    all_confs: list[float] = []
    for img in images:
        text, confs = ocr_image(img, code)
        page_texts.append(text)
        all_confs += confs
    confidence = sum(all_confs) / len(all_confs) / 100 if all_confs else 0.0
    return {
        "text": clean_pages(page_texts),
        "confidence": round(confidence, 3),
        "pages": len(images),
    }
