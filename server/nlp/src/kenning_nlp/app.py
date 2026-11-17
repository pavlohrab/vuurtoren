"""FastAPI entry point: stateless analysis endpoints."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from kenning_nlp import __version__
from kenning_nlp.detect import detect
from kenning_nlp.models import (
    AnalyzeRequest,
    Detection,
    DetectRequest,
    TermAnalysis,
    TextAnalysis,
)
from kenning_nlp.pipeline import analyze_terms, analyze_texts

app = FastAPI(title="Kenning NLP", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("KENNING_CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.post("/analyze/text")
def analyze_text_endpoint(req: AnalyzeRequest) -> list[TextAnalysis]:
    return analyze_texts(req.lang, req.texts)


@app.post("/analyze/terms")
def analyze_terms_endpoint(req: AnalyzeRequest) -> list[TermAnalysis]:
    return analyze_terms(req.lang, req.texts)


@app.post("/detect")
def detect_endpoint(req: DetectRequest) -> list[Detection]:
    return detect(req.texts)
