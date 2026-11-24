"""FastAPI entry point: stateless analysis, import (URL/PDF/OCR) and gloss endpoints."""

from __future__ import annotations

import os
import secrets
import threading
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Annotated

from fastapi import FastAPI, File, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from vuurtoren_nlp import __version__, analyzer, lexicon, packs, translate
from vuurtoren_nlp.audio import clip_path
from vuurtoren_nlp.course import COURSE_MAX_UPLOAD_BYTES, CourseOcr
from vuurtoren_nlp.detect import detect
from vuurtoren_nlp.dictionary import Dictionary, DictionaryMissingError
from vuurtoren_nlp.dictionary import default_db_path as default_dictionary_path
from vuurtoren_nlp.errors import ServiceError, read_upload
from vuurtoren_nlp.extract_url import extract_from_url
from vuurtoren_nlp.grammar import detect_grammar
from vuurtoren_nlp.grammar_examples import GrammarExamples
from vuurtoren_nlp.health import health_report
from vuurtoren_nlp.models import (
    GRAMMAR_EXAMPLE_LIMIT,
    MAX_TOTAL_CHARS,
    MT_MAX_TOTAL_CHARS,
    AlignedText,
    AlignRequest,
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
    PairedText,
    PairRequest,
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
from vuurtoren_nlp.ocr import OCR_LANGS, run_ocr
from vuurtoren_nlp.pdf import cover_thumbnail, extract_pdf
from vuurtoren_nlp.pipeline import analyze_terms, analyze_texts
from vuurtoren_nlp.sentences import SentencesMissingError, SentenceStore
from vuurtoren_nlp.sentences import default_db_path as default_sentences_path
from vuurtoren_nlp.similar import SimilarMissingError, SimilarService
from vuurtoren_nlp.translate import translate_texts
from vuurtoren_nlp.wordforms import WordFormsMissingError, WordFormsStore


def parse_origins(raw: str) -> list[str]:
    """Comma-separated origins -> list; whitespace is stripped and empty entries dropped."""
    return [o.strip() for o in raw.split(",") if o.strip()]


def check_total(texts: list[str], limit: int = MAX_TOTAL_CHARS) -> None:
    """Reject a request whose strings together exceed ``limit`` characters (HTTP 413)."""
    if sum(map(len, texts)) > limit:
        raise ServiceError(413, f"Request too large (limit {limit} characters in total).")


WARMUP_TEXT = "Ik lees elke avond een boek."


def warm_up() -> None:
    """Load the analysis and translation models before the first request needs them.

    They load on first use, which made the first analysis after a start take 1.6-2 s and the
    first word tap about 1.2 s (A9). This runs once, in the background, after any pack install
    has finished; a missing model is simply skipped (it loads, or fails, on first use as before).
    """
    while packs.busy():
        time.sleep(0.5)
    for step in (
        lambda: analyze_texts("nl", [WARMUP_TEXT]),
        lambda: translate_texts("nl", "en", [WARMUP_TEXT]),
    ):
        try:
            step()
        except Exception:  # noqa: BLE001 - a warm-up must never take the server down
            continue


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Data packs (vuurtoren_nlp.packs): install missing/outdated ones in the background, so the
    # service answers /health at once and features light up as their data arrives.
    if packs.mode() != "off":
        packs.ensure_in_background()
    # Then the models, also in the background (not in tests, and not when switched off).
    if os.environ.get("VUURTOREN_WARMUP", "1") != "0" and "PYTEST_CURRENT_TEST" not in os.environ:
        threading.Thread(target=warm_up, name="vuurtoren-warmup", daemon=True).start()
    yield


app = FastAPI(title="Vuurtoren NLP", version=__version__, lifespan=lifespan)

TOKEN_HEADER = "x-vuurtoren-token"


@app.middleware("http")
async def require_token(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Desktop sidecar: with ``$VUURTOREN_NLP_TOKEN`` set, every request must carry it.

    The desktop app starts this server on a random localhost port and sends the token from its
    own process, so other programs and web pages on this computer cannot use the server.
    """
    token = os.environ.get("VUURTOREN_NLP_TOKEN")
    if token and not secrets.compare_digest(request.headers.get(TOKEN_HEADER, ""), token):
        return JSONResponse({"detail": "Missing or wrong token."}, status_code=401)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_origins(os.environ.get("VUURTOREN_CORS_ORIGINS", "http://localhost:5173")),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(ServiceError)
def service_error_handler(_: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


@app.get("/health")
def health() -> dict[str, object]:
    """Liveness plus version and data presence (vuurtoren_nlp.health)."""
    return health_report()


@app.get("/admin/packs")
def packs_status() -> dict[str, object]:
    """Data pack state (also part of ``/health``)."""
    return {"mode": packs.mode(), "busy": packs.busy(), "items": packs.status()}


@app.post("/admin/packs")
def packs_update(force: bool = False) -> dict[str, object]:
    """Install missing or outdated data packs now (in the background; poll ``GET``).

    ``force`` also replaces unversioned data. Works in every ``VUURTOREN_PACKS`` mode except that
    local builds need ``auto``. Behind the sign-in like every /nlp/ route.
    """
    started = packs.ensure_in_background(force=force)
    return {"started": started, **packs_status()}


@app.get("/packs/{file}")
def phone_pack(file: str) -> Response:
    """The archive of a pack the Android app keeps (``dictionary-nl-<version>.tar.gz``).

    Behind the sign-in like every /nlp/ route, so a paired phone fetches it with its sync token.
    Ranges work, so a broken download goes on where it stopped. 404 when this server has no copy
    at the manifest version (the phone then uses the public packs release).
    """
    path = packs.phone_archive(file)
    if path is None:
        return JSONResponse({"detail": "This server has no copy of that pack."}, status_code=404)
    return FileResponse(path, media_type="application/gzip", filename=file)


@app.get("/audio/{voice}/{clip}.mp3")
def audio_clip(voice: str, clip: str) -> Response:
    """A spoken starter word or sentence from the ``audio-nl`` pack; 404 when there is none."""
    path = clip_path(voice, clip)
    if path is None:
        return JSONResponse({"detail": "No such clip."}, status_code=404)
    # A clip's id comes from its text: the same id is always the same sound.
    return FileResponse(
        path, media_type="audio/mpeg", headers={"Cache-Control": "max-age=31536000, immutable"}
    )


@app.get("/speech")
def speech(text: str, rate: float = 1.0) -> Response:
    """``text`` said by the Dutch voice (Piper) as WAV: for words without a recording on a computer
    without a Dutch system voice. 503 when the voice is not installed."""
    from vuurtoren_nlp.speech import synthesize

    audio = synthesize(text, rate)
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "max-age=86400"})


@app.post("/analyze/text")
def analyze_text_endpoint(req: AnalyzeRequest) -> list[TextAnalysis]:
    check_total(req.texts)
    version = analyzer.analyzer_version()
    return [
        a.model_copy(update={"analyzerVersion": version})
        for a in analyze_texts(req.lang, req.texts)
    ]


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
    # Parsing is blocking: run it in the threadpool so the event loop keeps serving requests.
    return PdfExtraction(**await run_in_threadpool(extract_pdf, data))


@app.post("/thumbnail")
async def thumbnail_endpoint(file: Annotated[UploadFile, File()]) -> Response:
    """A 600x750 WebP cover of a PDF's first page or of a photo (Library covers)."""
    data = await read_upload(file)
    webp = await run_in_threadpool(cover_thumbnail, data)
    return Response(content=webp, media_type="image/webp")


@app.post("/ocr", response_model_exclude_none=True)
async def ocr_endpoint(
    file: Annotated[UploadFile, File()],
    lang: Annotated[str, Query(pattern=f"^({'|'.join(OCR_LANGS)})$")] = "nl",
    review: bool = False,
) -> OcrResult:
    """OCR an image (png/jpg/webp/tiff) or a PDF. 503 if RapidOCR is not installed.

    ``review=true`` adds ``review``: page images and the words that may be misread, with
    suggestions (see :mod:`vuurtoren_nlp.ocr_review`).
    """
    data = await read_upload(file)
    return OcrResult(**await run_in_threadpool(run_ocr, data, lang, review))


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


@app.post("/translate/align")
def align_endpoint(req: AlignRequest) -> list[AlignedText]:
    """Translate texts and give the English of the given words: the in-context meaning of a word
    the dictionary does not know (see :mod:`vuurtoren_nlp.align`). 503 without the model."""
    check_total([it.text for it in req.items], MT_MAX_TOTAL_CHARS)
    items = [(it.text, list(it.spans)) for it in req.items]
    return [AlignedText(**t) for t in translate.align_texts(req.source, req.target, items)]


@app.post("/translate/pairs")
def pairs_endpoint(req: PairRequest) -> list[PairedText]:
    """Translate sentences (or take the given English) and pair their words with the English
    words, for the side-by-side reader (see :mod:`vuurtoren_nlp.pairs`). 503 without the model."""
    check_total(
        [it.text for it in req.items] + [it.translation or "" for it in req.items],
        MT_MAX_TOTAL_CHARS,
    )
    items = [(it.text, list(it.spans), list(it.joins), it.translation) for it in req.items]
    return [PairedText(**t) for t in translate.pair_texts(req.source, req.target, items)]


@app.post("/translate")
def translate_endpoint(req: TranslateRequest) -> list[Translation]:
    """Offline Dutch -> English machine translation (OPUS-MT on CTranslate2).

    Texts should be sentences or short paragraphs. ``context`` is accepted but currently has no
    effect. 503 if the model has not been fetched (``scripts/fetch_mt_model.py``).
    """
    check_total(req.texts, MT_MAX_TOTAL_CHARS)
    return [Translation(**t) for t in translate_texts(req.source, req.target, req.texts)]


# --------------------------------------------------------------------------- practice data
# Stores are created per request (cheap: they only check the files) and the expensive parts are
# cached inside them / below, so that a data file built after startup is picked up without a
# restart and a missing file gives a 503 with build instructions rather than a crash.


@lru_cache(maxsize=1)
def _similar_service() -> SimilarService:
    return SimilarService(default_dictionary_path())


def _drop_data_caches() -> None:
    """After a data pack update: forget everything that holds the old files."""
    _dictionary.cache_clear()
    _similar_service.cache_clear()
    lexicon.get_lexicon.cache_clear()
    translate.reset_engine()
    analyzer.reset()


packs.on_installed(_drop_data_caches)


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
    file: Annotated[list[UploadFile], File()],
    lang: Annotated[str, Query(pattern=f"^({'|'.join(OCR_LANGS)})$")] = "nl",
) -> dict[str, object]:
    """Start a background OCR job over a PDF or page photos; poll ``GET /course/ocr/{id}``.

    Several ``file`` fields (photos of pages) are read in order as one book. The size limit
    applies to all files together.
    """
    datas: list[bytes] = []
    left = COURSE_MAX_UPLOAD_BYTES
    for f in file:
        try:
            data = await read_upload(f, left)
        except ServiceError as e:
            if e.status_code == 413:
                raise ServiceError(
                    413, f"Files too large (limit {COURSE_MAX_UPLOAD_BYTES // (1024 * 1024)} MB)."
                ) from e
            raise
        left -= len(data)
        datas.append(data)
    # Validation opens every file (and checks the OCR engine): blocking, so off the event loop.
    job = await run_in_threadpool(_course_ocr.start, datas, lang)
    return {"id": job.id, "total": job.total}


@app.get("/course/ocr/{job_id}")
def course_ocr_status(job_id: str, after: Annotated[int, Query(ge=0)] = 0) -> dict[str, object]:
    """Progress of an OCR job and its pages from index ``after`` (page text + layout blocks)."""
    return _course_ocr.get(job_id).view(after)


@app.get("/course/ocr/{job_id}/page/{n}/image")
def course_ocr_page_image(job_id: str, n: int) -> Response:
    """A small WebP of a page that has review flags (for the review screen's image crops)."""
    return Response(content=_course_ocr.preview(job_id, n), media_type="image/webp")


@app.post("/course/ocr/{job_id}/cancel")
def course_ocr_cancel(job_id: str) -> dict[str, str]:
    """Stop a job and drop its results from memory."""
    _course_ocr.cancel(job_id)
    return {"status": "cancelled"}


# --------------------------------------------------------------------------------- grammar


@app.post("/grammar")
def grammar_endpoint(req: GrammarRequest) -> list[list[GrammarHit]]:
    """Grammar constructions found in each text (rule-based, see :mod:`vuurtoren_nlp.grammar`).

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
