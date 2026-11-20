import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from vuurtoren_nlp import rapid
from vuurtoren_nlp.app import app
from vuurtoren_nlp.ocr import words_to_text

client = TestClient(app)
HAS_RAPIDOCR = rapid.available()


def png_bytes(size=(200, 100), color="white") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def test_words_to_text_groups_lines_blocks_and_skips_non_words() -> None:
    data = {
        "text": ["", "Hallo", "wereld", "Tweede", "kolom", "x"],
        "conf": [-1, 90, 80, 70, 60, -1],
        "block_num": [1, 1, 1, 2, 2, 2],
        "par_num": [0, 1, 1, 1, 1, 1],
        "line_num": [0, 1, 1, 1, 2, 2],
    }
    text, confs = words_to_text(data)
    assert text == "Hallo wereld\n\nTweede\nkolom"
    assert confs == [90, 80, 70, 60]


def test_missing_rapidocr_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rapid, "available", lambda: False)
    r = client.post("/ocr", files={"file": ("a.png", png_bytes(), "image/png")})
    assert r.status_code == 503
    assert "vuurtoren-nlp[ocr]" in r.json()["detail"]


def test_ocr_reads_dutch_only_422() -> None:
    for lang in ("xx", "uk", "de"):
        r = client.post(f"/ocr?lang={lang}", files={"file": ("a.png", png_bytes(), "image/png")})
        assert r.status_code == 422


@pytest.mark.skipif(not HAS_RAPIDOCR, reason="rapidocr not installed")
def test_not_an_image_415() -> None:
    r = client.post("/ocr", files={"file": ("a.txt", b"plain text", "text/plain")})
    assert r.status_code == 415


def _text_image(lines: list[str]) -> bytes:
    font = ImageFont.load_default(size=42)
    img = Image.new("RGB", (1400, 120 * len(lines) + 40), "white")
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        draw.text((40, 30 + i * 110), line, fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.skipif(not HAS_RAPIDOCR, reason="rapidocr not installed")
def test_ocr_png_integration() -> None:
    r = client.post(
        "/ocr?lang=nl",
        files={
            "file": (
                "a.png",
                _text_image(["Het huis is groot", "De fiets staat buiten"]),
                "image/png",
            )
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["pages"] == 1
    assert "huis" in body["text"].lower()
    assert 0 < body["confidence"] <= 1


@pytest.mark.skipif(not HAS_RAPIDOCR, reason="rapidocr not installed")
def test_ocr_scanned_pdf_integration() -> None:
    img = Image.open(io.BytesIO(_text_image(["Dit is een scan"])))
    buf = io.BytesIO()
    img.save(buf, format="PDF")
    r = client.post("/ocr", files={"file": ("scan.pdf", buf.getvalue(), "application/pdf")})
    assert r.status_code == 200
    assert "scan" in r.json()["text"].lower()
