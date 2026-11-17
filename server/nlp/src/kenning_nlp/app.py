"""FastAPI entry point: stateless analysis, import (URL/PDF/OCR) and gloss endpoints."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Annotated

from fastapi import FastAPI, File, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from kenning_nlp import __version__
from kenning_nlp.detect import detect
from kenning_nlp.dictionary import Dictionary, DictionaryMissingError
from kenning_nlp.errors import ServiceError, read_upload
from kenning_nlp.extract_url import extract_from_url
from kenning_nlp.models import (
    MAX_TOTAL_CHARS,
    AnalyzeRequest,
    AnalyzeTermsRequest,
    Detection,
    DetectRequest,
    ExtractUrlRequest,
    GlossEntry,
    GlossRequest,
    OcrResult,
    PdfExtraction,
    TermAnalysis,
    TextAnalysis,
    UrlExtraction,
)
from kenning_nlp.ocr import TESSERACT_LANGS, run_ocr
from kenning_nlp.pdf import extract_pdf
from kenning_nlp.pipeline import analyze_terms, analyze_texts


def parse_origins(raw: str) -> list[str]:
    """Comma-separated origins -> list; whitespace is stripped and empty entries dropped."""
    return [o.strip() for o in raw.split(",") if o.strip()]


def check_total(texts: list[str]) -> None:
    """Reject a request whose strings together exceed ``MAX_TOTAL_CHARS`` (HTTP 413)."""
    if sum(map(len, texts)) > MAX_TOTAL_CHARS:
        raise ServiceError(413, f"Request too large (limit {MAX_TOTAL_CHARS} characters in total).")


app = FastAPI(title="Kenning NLP", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_origins(os.environ.get("KENNING_CORS_ORIGINS", "http://localhost:5173")),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(ServiceError)
def service_error_handler(_: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.post("/analyze/text")
def analyze_text_endpoint(req: AnalyzeRequest) -> list[TextAnalysis]:
    check_total(req.texts)
    return analyze_texts(req.lang, req.texts)


@app.post("/analyze/terms")
def analyze_terms_endpoint(req: AnalyzeTermsRequest) -> list[TermAnalysis]:
    check_total(req.texts)
    return analyze_terms(req.lang, req.texts)


@app.post("/detect")
def detect_endpoint(req: DetectRequest) -> list[Detection]:
    check_total(req.texts)
    return detect(req.texts)


@app.post("/extract/url")
def extract_url_endpoint(req: ExtractUrlRequest) -> UrlExtraction:
    """Fetch a web page (SSRF-protected) and return its main article text."""
    return UrlExtraction(**extract_from_url(req.url))


@app.post("/extract/pdf")
async def extract_pdf_endpoint(file: Annotated[UploadFile, File()]) -> PdfExtraction:
    """Extract text from a text-layer PDF; ``needs_ocr`` flags scans."""
    data = await read_upload(file)
    return PdfExtraction(**extract_pdf(data))


@app.post("/ocr")
async def ocr_endpoint(
    file: Annotated[UploadFile, File()],
    lang: Annotated[str, Query(pattern=f"^({'|'.join(TESSERACT_LANGS)})$")] = "nl",
) -> OcrResult:
    """OCR an image (png/jpg/webp/tiff) or a PDF. 503 if Tesseract is not installed."""
    data = await read_upload(file)
    return OcrResult(**run_ocr(data, lang))


@lru_cache(maxsize=1)
def _dictionary() -> Dictionary:
    return Dictionary()


@app.post("/gloss", response_model_exclude_unset=True)
def gloss_endpoint(req: GlossRequest) -> dict[str, list[GlossEntry]]:
    """Short English glosses (Wiktionary/Kaikki) for Dutch words.

    Words without an entry are analysed as compounds: the entry then has ``compound: true`` and
    ``parts``. ``compound``/``parts`` are omitted for ordinary entries.
    """
    try:
        entries = _dictionary().lookup(req.words)
    except DictionaryMissingError as e:
        raise ServiceError(503, str(e)) from e
    return {w: [GlossEntry(**e) for e in es] for w, es in entries.items()}
