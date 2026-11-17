"""FastAPI entry point: stateless analysis, import (URL/PDF/OCR) and gloss endpoints."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Annotated

from fastapi import FastAPI, File, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from kenning_nlp import __version__
from kenning_nlp.course import COURSE_MAX_UPLOAD_BYTES, CourseOcr
from kenning_nlp.detect import detect
from kenning_nlp.dictionary import Dictionary, DictionaryMissingError
from kenning_nlp.dictionary import default_db_path as default_dictionary_path
from kenning_nlp.errors import ServiceError, read_upload
from kenning_nlp.extract_url import extract_from_url
from kenning_nlp.grammar import detect_grammar
from kenning_nlp.grammar_examples import GrammarExamples
from kenning_nlp.models import (
    GRAMMAR_EXAMPLE_LIMIT,
    MAX_TOTAL_CHARS,
    MT_MAX_TOTAL_CHARS,
    AnalyzeRequest,
    AnalyzeTermsRequest,
    Detection,
    DetectRequest,
    ExampleSentence,
    ExtractUrlRequest,
    FormsRequest,
    GlossEntry,
    GlossRequest,
    GrammarExample,
    GrammarHit,
    GrammarRequest,
    OcrResult,
    PdfExtraction,
    SentencesRequest,
    SimilarRequest,
    TermAnalysis,
    TextAnalysis,
    TranslateRequest,
    Translation,
    UrlExtraction,
    WordForms,
)
from kenning_nlp.ocr import TESSERACT_LANGS, run_ocr
from kenning_nlp.pdf import extract_pdf
from kenning_nlp.pipeline import analyze_terms, analyze_texts
from kenning_nlp.sentences import SentencesMissingError, SentenceStore
from kenning_nlp.sentences import default_db_path as default_sentences_path
from kenning_nlp.similar import SimilarMissingError, SimilarService
from kenning_nlp.translate import translate_texts
from kenning_nlp.wordforms import WordFormsMissingError, WordFormsStore


def parse_origins(raw: str) -> list[str]:
    """Comma-separated origins -> list; whitespace is stripped and empty entries dropped."""
    return [o.strip() for o in raw.split(",") if o.strip()]


def check_total(texts: list[str], limit: int = MAX_TOTAL_CHARS) -> None:
    """Reject a request whose strings together exceed ``limit`` characters (HTTP 413)."""
    if sum(map(len, texts)) > limit:
        raise ServiceError(413, f"Request too large (limit {limit} characters in total).")


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


@app.post("/translate")
def translate_endpoint(req: TranslateRequest) -> list[Translation]:
    """Offline Dutch -> English machine translation (OPUS-MT on CTranslate2).

    Texts should be sentences or short paragraphs. ``context`` is accepted but currently has no
    effect. 503 if the model has not been fetched (``scripts/fetch_mt_model.py``).
    """
    check_total(req.texts, MT_MAX_TOTAL_CHARS)
    return [Translation(**t) for t in translate_texts(req.source, req.target, req.texts)]


# --------------------------------------------------------------------------- practice data (M4)
# Stores are created per request (cheap: they only check the files) and the expensive parts are
# cached inside them / below, so that a data file built after startup is picked up without a
# restart and a missing file gives a 503 with build instructions rather than a crash.


@lru_cache(maxsize=1)
def _similar_service() -> SimilarService:
    return SimilarService(default_dictionary_path())


@app.post("/forms", response_model_exclude_none=True)
def forms_endpoint(req: FormsRequest) -> dict[str, WordForms]:
    """Morphology (Wiktionary) for form exercises: ``{lemma: WordForms}``.

    Unknown lemmas and POS without morphology map to ``{}``. 503 if the dictionary DB is missing
    or too old (rebuild it with ``scripts/build_dictionary.py``).
    """
    try:
        store = WordFormsStore(default_dictionary_path(), default_sentences_path())
    except WordFormsMissingError as e:
        raise ServiceError(503, str(e)) from e
    found = store.lookup((p.lemma, p.pos) for p in req.lemmas)
    return {lemma: WordForms(**data) for lemma, data in found.items()}


@app.post("/sentences")
def sentences_endpoint(req: SentencesRequest) -> dict[str, list[ExampleSentence]]:
    """Tatoeba example sentences with English translations: ``{lemma: [ExampleSentence]}``.

    Shortest / commonest-vocabulary sentences first. 503 if the sentence DB has not been built
    (``scripts/build_sentences.py``).
    """
    try:
        found = SentenceStore(default_sentences_path()).lookup(req.lemmas, req.limit, req.maxWords)
    except SentencesMissingError as e:
        raise ServiceError(503, str(e)) from e
    return {lemma: [ExampleSentence(**s) for s in sents] for lemma, sents in found.items()}


@app.post("/similar")
def similar_endpoint(req: SimilarRequest) -> dict[str, list[str]]:
    """Distractor lemmas (same POS, similar frequency, related but not synonyms).

    The first request builds the similarity index (a few seconds). 503 if the dictionary DB is
    missing. Words without a vector map to ``[]``.
    """
    try:
        return _similar_service().lookup(((w.lemma, w.pos) for w in req.words), req.k)
    except SimilarMissingError as e:
        raise ServiceError(503, str(e)) from e


# --------------------------------------------------------------------------- courses (C1)

_course_ocr = CourseOcr()


@app.post("/course/ocr")
async def course_ocr_start(
    file: Annotated[UploadFile, File()],
    lang: Annotated[str, Query(pattern=f"^({'|'.join(TESSERACT_LANGS)})$")] = "nl",
) -> dict[str, object]:
    """Start a background OCR job over a PDF/image upload; poll ``GET /course/ocr/{id}``."""
    data = await read_upload(file, COURSE_MAX_UPLOAD_BYTES)
    job = _course_ocr.start(data, lang)
    return {"id": job.id, "total": job.total}


@app.get("/course/ocr/{job_id}")
def course_ocr_status(job_id: str, after: Annotated[int, Query(ge=0)] = 0) -> dict[str, object]:
    """Progress of an OCR job and its pages from index ``after`` (page text + layout blocks)."""
    return _course_ocr.get(job_id).view(after)


@app.post("/course/ocr/{job_id}/cancel")
def course_ocr_cancel(job_id: str) -> dict[str, str]:
    """Stop a job and drop its results from memory."""
    _course_ocr.cancel(job_id)
    return {"status": "cancelled"}


# --------------------------------------------------------------------------------- grammar (M5)


@app.post("/grammar")
def grammar_endpoint(req: GrammarRequest) -> list[list[GrammarHit]]:
    """Grammar constructions found in each text (rule-based, see :mod:`kenning_nlp.grammar`).

    One list of hits per input text, in text order. ``tokens`` index the tokens that
    ``/analyze/text`` returns for the same text; ``start``/``end`` give the sentence span, so
    the hits can also be mapped onto an analysis made elsewhere.
    """
    check_total(req.texts)
    return [
        detect_grammar(t, a)
        for t, a in zip(req.texts, analyze_texts(req.lang, req.texts), strict=True)
    ]


@app.get("/grammar/examples")
def grammar_examples_endpoint(
    topic: Annotated[str, Query(pattern="^[a-z][a-z0-9-]{0,60}$")],
    limit: Annotated[int, Query(ge=1, le=GRAMMAR_EXAMPLE_LIMIT)] = GRAMMAR_EXAMPLE_LIMIT,
) -> list[GrammarExample]:
    """Tatoeba sentences in which the detector for ``topic`` fired (scanned lazily and cached).

    Topics without a detector give ``[]``. A rare topic may return fewer than ``limit`` on the
    first request (the scan has a time budget); asking again continues the scan. 503 if the
    sentence DB has not been built.
    """
    path = default_sentences_path()
    if not path.is_file():
        raise ServiceError(
            503,
            f"Sentence database not found at {path}. "
            "Build it once with: uv run python scripts/build_sentences.py",
        )
    return [GrammarExample(**e) for e in GrammarExamples(path).examples(topic, limit)]
