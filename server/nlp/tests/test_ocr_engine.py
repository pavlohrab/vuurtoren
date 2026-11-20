"""The OCR engine (RapidOCR) and its reading order."""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

import vuurtoren_nlp.ocr as ocr
from vuurtoren_nlp import rapid
from vuurtoren_nlp.app import app
from vuurtoren_nlp.errors import ServiceError
from vuurtoren_nlp.ocr import ensure_engine, lang_of_code, words_to_text
from vuurtoren_nlp.ocr_review import page_words
from vuurtoren_nlp.rapid import Line, Word, layout, to_data

client = TestClient(app)


def test_rapidocr_reads_the_pages(monkeypatch) -> None:
    monkeypatch.setattr(rapid, "available", lambda: True)
    assert ensure_engine("nl") == "rapidocr-nl"
    assert lang_of_code("rapidocr-nl") == "nl"


def test_no_engine_is_a_503_with_install_hint(monkeypatch) -> None:
    monkeypatch.setattr(rapid, "available", lambda: False)
    with pytest.raises(ServiceError) as e:
        ensure_engine("nl")
    assert e.value.status_code == 503 and "RapidOCR" in e.value.detail
    assert ocr.ocr_engine_name() is None


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_ocr_endpoint_reads_with_rapidocr(monkeypatch) -> None:
    monkeypatch.setattr(rapid, "available", lambda: True)
    seen = {}

    def fake_recognize(img, lang):
        seen["lang"] = lang
        return {
            "text": ["Hallo", "wereld"],
            "conf": [91, 89],
            "block_num": [1, 1],
            "par_num": [1, 1],
            "line_num": [1, 1],
            "left": [10, 80],
            "top": [10, 10],
            "width": [60, 70],
            "height": [20, 20],
        }

    monkeypatch.setattr(rapid, "recognize", fake_recognize)
    r = client.post("/ocr", files={"file": ("a.png", _png(Image.new("RGB", (300, 80), "white")))})
    assert r.status_code == 200
    assert r.json()["text"] == "Hallo wereld" and seen["lang"] == "nl"


def test_health_reports_the_engine(monkeypatch) -> None:
    monkeypatch.setattr(rapid, "available", lambda: True)
    body = client.get("/health").json()
    assert body["ocr"] is True and body["ocrEngine"] == "rapidocr"


# --------------------------------------------------------------------------- layout


def line(text: str, x: float, y: float, h: float = 20, cw: float = 10) -> Line:
    """A detected line starting at (x, y); each character ``cw`` wide."""
    words, pos = [], x
    for w in text.split():
        words.append(Word(w, 0.98, pos, y, pos + cw * len(w), y + h))
        pos += cw * (len(w) + 1)
    return Line(words)


def text_of(lines: list[Line]) -> str:
    return words_to_text(to_data(layout(lines)))[0]


def test_two_text_columns_are_read_one_after_the_other() -> None:
    lines = [
        line("het huis", 100, 100),
        line("de tafel (een tafel van hout)", 600, 100),
        line("de vergaderruimte", 100, 130),
        line("de stoel", 600, 130),
        line("het raam", 100, 160),
        line("de deur", 600, 160),
    ]
    assert text_of(lines) == (
        "het huis\nde vergaderruimte\nhet raam\n\nde tafel (een tafel van hout)\nde stoel\nde deur"
    )


def test_tables_and_label_columns_are_read_row_by_row() -> None:
    table = [
        line("1 ik", 100, 100),
        line("loop", 300, 100),
        line("lees", 450, 100),
        line("2 jij", 100, 130),
        line("loopt", 300, 130),
        line("leest", 450, 130),
    ]
    assert text_of(table) == "1 ik loop lees\n2 jij loopt leest"
    labelled = [
        line("Plaats:", 100, 100),
        line("de markt / het plein", 300, 100),
        line("Dingen:", 100, 130),
        line("fruit de appel, de peer, de banaan,", 300, 130),
    ]
    assert text_of(labelled).startswith("Plaats: de markt / het plein\nDingen: fruit")


def test_wide_gaps_split_paragraphs_and_reading_order_follows_the_page() -> None:
    lines = [
        line("Tweede alinea begint hier.", 100, 300),
        line("Eerste alinea.", 100, 100),
        line("Nog een regel.", 100, 125),
    ]
    assert text_of(lines) == "Eerste alinea.\nNog een regel.\n\nTweede alinea begint hier."


def test_rows_feed_word_boxes_for_review() -> None:
    data = to_data(layout([line("Wij gingen sarnen", 100, 50)]))
    words = page_words(data, 1000, 500, 1)
    assert [w.text for w in words] == ["Wij", "gingen", "sarnen"]
    assert words[2].x == pytest.approx(0.21) and words[2].conf == 98.0


# --------------------------------------------------------------------------- real engine


FONTS = (
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/Library/Fonts/Arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
)


def _font_with_accents(size: int):
    """A system font that has accented letters (Pillow's built-in one has none)."""
    from pathlib import Path

    for f in FONTS:
        if Path(f).is_file():
            return ImageFont.truetype(f, size)
    pytest.skip("no font with accented letters found")


@pytest.mark.skipif(not rapid.available(), reason="RapidOCR not installed")
def test_rapidocr_reads_dutch_with_diacritics() -> None:
    font = _font_with_accents(44)
    img = Image.new("RGB", (1400, 360), "white")
    draw = ImageDraw.Draw(img)
    for i, text in enumerate(["Het huis is groot.", "Eén keer per week.", "De calorieën tellen."]):
        draw.text((60, 40 + i * 110), text, fill="black", font=font)
    page = ocr.recognize(img, "rapidocr-nl")
    text = words_to_text(page.data)[0]
    assert "huis" in text and "Eén" in text and "calorieën" in text
    assert all(0 <= c <= 100 for c in page.data["conf"])


def test_glued_words_are_split_but_compounds_stay_whole() -> None:
    from vuurtoren_nlp.rapid import split_glued

    assert split_glued("Komtu") == ["Komt", "u"]
    assert split_glued("zomooi,") == ["zo", "mooi,"]
    assert split_glued("woning.De") == ["woning.", "De"]
    assert split_glued("3Fietsen") == ["3", "Fietsen"]
    for word in ("fietsenstalling", "boekenkast", "www.nu.nl", "€3,20", "Annas"):
        assert split_glued(word) == [word]
    assert split_glued("Komtu", lang="de") == ["Komtu"]
