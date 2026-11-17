"""FastAPI entry point. Endpoints (/analyze, /ocr, /translate, ...) arrive in M1+."""

from fastapi import FastAPI

from kenning_nlp import __version__

app = FastAPI(title="Kenning NLP", version=__version__)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}
