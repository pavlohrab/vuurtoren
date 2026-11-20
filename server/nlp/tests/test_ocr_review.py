"""OCR review flags: confusion suggestions, alignment to the cleaned text, endpoints."""

import io
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

import vuurtoren_nlp.app as app_module
from vuurtoren_nlp import rapid
from vuurtoren_nlp.app import app
from vuurtoren_nlp.cleanup import clean_pages
from vuurtoren_nlp.course import CourseOcr
from vuurtoren_nlp.ocr_review import OcrWord, align, assess, find_flags, page_words, suggestions

HAS_RAPIDOCR = rapid.available()


def words(lines: list[list[tuple[str, float]]], page: int = 1) -> list[OcrWord]:
    """Fake OCR words: one line per inner list, boxes laid out left to right."""
    out = []
    for li, line in enumerate(lines):
        for wi, (text, conf) in enumerate(line):
            out.append(OcrWord(text, conf, page, 0.1 * wi, 0.05 * li, 0.08, 0.04, (1, 1, li + 1)))
    return out


def page_text(lines: list[list[tuple[str, float]]]) -> str:
    return "\n".join(" ".join(t for t, _ in line) for line in lines)


@pytest.mark.parametrize(
    ("word", "best"),
    [
        ("rnaar", "maar"),
        ("rnoeder", "moeder"),
        ("vvant", "want"),
        ("we1", "wel"),
        ("h0e", "hoe"),
        ("tiid", "tijd"),
        ("cloor", "door"),
        ("Amsterdarn", "Amsterdam"),
        ("eenhuis", "een huis"),
    ],
)
def test_typical_confusions_are_suggested_first(word: str, best: str) -> None:
    assert suggestions(word)[0] == best


def test_case_follows_the_position_when_the_first_letter_was_misread() -> None:
    assert suggestions("Iand")[0] == "land"
    assert suggestions("Iand", sentence_start=True)[0] == "Land"
    assert suggestions("Rnaar")[0] == "Maar"


def test_assess_known_names_numbers_and_abbreviations_are_quiet() -> None:
    for w in ["huis", "fietsenstalling", "Amsterdam", "1984", "12,50", "NOS", "Jansen"]:
        assert assess(w, 90) is None, w
    assert assess("rnaar", 90) == ("unknown", ["maar"])
    assert assess("ln", 90) is not None and assess("ln", 90)[1][0] == "in"


def test_low_confidence_flags_a_known_word() -> None:
    reason, _ = assess("huis", 30)
    assert reason == "low"


def test_unknown_capitalised_word_mid_sentence_is_a_name_unless_unsure() -> None:
    assert assess("Zwolsma", 90) is None
    assert assess("Zwolsma", 30) == ("low", [])


def test_align_maps_hyphen_joins_and_dropped_page_numbers() -> None:
    lines = [
        [("12", 95)],
        [("Het", 95), ("was", 95), ("een", 95), ("lan-", 90)],
        [("ge", 90), ("dag.", 95)],
    ]
    text = clean_pages([page_text(lines)])
    assert text == "Het was een lange dag."
    toks = align(text, words(lines))
    joined = next(t for t in toks if t.text == "lange")
    assert [w.text for w in joined.words] == ["lan-", "ge"]


def test_find_flags_offsets_boxes_and_suggestions() -> None:
    lines = [
        [("Wij", 95), ("gingen", 95), ("sarnen", 88)],
        [("naar", 95), ("de", 95), ("rnarkt.", 85)],
    ]
    text = clean_pages([page_text(lines)])
    flags = find_flags(text, words(lines))
    assert [f["word"] for f in flags] == ["sarnen", "rnarkt"]
    first = flags[0]
    assert text[first["start"] : first["end"]] == "sarnen"
    assert first["suggestions"][0] == "samen" and first["reason"] == "unknown"
    assert first["box"] == {"page": 1, "x": 0.2, "y": 0.0, "w": 0.08, "h": 0.04}
    assert flags[1]["conf"] == 0.85


def test_broken_hyphenation_across_blocks_is_offered_joined() -> None:
    text = "Ze kochten verse groen-\n\nten voor het eten."
    ws = words([[(t, 95) for t in text.split()]])
    flags = find_flags(text, ws)
    assert len(flags) == 1
    f = flags[0]
    assert f["reason"] == "hyphen" and f["suggestions"] == ["groenten"]
    assert text[f["start"] : f["end"]] == "groen-\n\nten"


def test_page_words_order_and_skip_non_words() -> None:
    data = {
        "text": ["", "tweede", "Eerste", "regel"],
        "conf": [-1, 80, 90, 70],
        "block_num": [1, 1, 1, 1],
        "par_num": [1, 1, 1, 1],
        "line_num": [0, 2, 1, 1],
        "left": [0, 10, 10, 60],
        "top": [0, 50, 10, 10],
        "width": [0, 40, 40, 30],
        "height": [0, 10, 10, 10],
    }
    ws = page_words(data, 100, 100, 3)
    assert [w.text for w in ws] == ["Eerste", "regel", "tweede"]
    assert ws[0].page == 3 and ws[1].x == 0.6


def png(lines: list[str]) -> bytes:
    font = ImageFont.load_default(size=40)
    img = Image.new("RGB", (1500, 110 * len(lines) + 60), "white")
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        draw.text((50, 40 + i * 105), line, fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_ocr_without_review_has_no_review_field(monkeypatch) -> None:
    monkeypatch.setattr(
        app_module,
        "run_ocr",
        lambda data, lang, review=False: {"text": "x", "confidence": 1.0, "pages": 1},
    )
    r = TestClient(app).post("/ocr", files={"file": ("a.png", b"x", "image/png")})
    assert r.status_code == 200 and "review" not in r.json()


@pytest.mark.skipif(not HAS_RAPIDOCR, reason="rapidocr not installed")
def test_ocr_review_integration() -> None:
    data = png(["Het was een rnooie dag in Amsterdarn.", "Wij gingen sarnen naar de markt."])
    r = TestClient(app).post(
        "/ocr?lang=nl&review=true", files={"file": ("p.png", data, "image/png")}
    )
    assert r.status_code == 200
    body = r.json()
    review = body["review"]
    assert review["pages"][0]["image"].startswith("data:image/webp;base64,")
    assert review["pages"][0]["width"] > review["pages"][0]["height"]
    found = {f["word"]: f for f in review["flags"]}
    assert found["rnooie"]["suggestions"][0] == "mooie"
    assert found["sarnen"]["suggestions"][0] == "samen"
    for f in review["flags"]:
        assert body["text"][f["start"] : f["end"]] == f["word"]


def test_course_job_publishes_flags_and_serves_the_page_image(monkeypatch, tmp_path) -> None:
    def engine(img, code):
        ws = words([[("Wij", 95), ("gingen", 95), ("sarnen", 88)]])
        return [{"text": "Wij gingen sarnen", "x": 0, "y": 0, "w": 1, "h": 1}], [95.0], ws

    monkeypatch.setattr(
        app_module, "_course_ocr", CourseOcr(engine, check=False, cache_dir=tmp_path)
    )
    client = TestClient(app)
    img = Image.new("RGB", (300, 200), "white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    jid = client.post("/course/ocr", files={"file": ("p.png", buf.getvalue(), "image/png")}).json()[
        "id"
    ]
    for _ in range(200):
        body = client.get(f"/course/ocr/{jid}").json()
        if body["status"] != "running":
            break
        time.sleep(0.01)
    page = body["pages"][0]
    assert page["review"]["image"] is True
    flag = page["review"]["flags"][0]
    assert page["text"][flag["start"] : flag["end"]] == "sarnen"
    pic = client.get(f"/course/ocr/{jid}/page/1/image")
    assert pic.status_code == 200 and pic.headers["content-type"] == "image/webp"
    assert client.get(f"/course/ocr/{jid}/page/2/image").status_code == 404
    # A new instance on the same disk cache still has the flags and the picture.
    monkeypatch.setattr(
        app_module, "_course_ocr", CourseOcr(engine, check=False, cache_dir=tmp_path)
    )
    jid2 = client.post(
        "/course/ocr", files={"file": ("p.png", buf.getvalue(), "image/png")}
    ).json()["id"]
    for _ in range(200):
        body = client.get(f"/course/ocr/{jid2}").json()
        if body["status"] != "running":
            break
        time.sleep(0.01)
    assert body["cached"] == 1 and body["pages"][0]["review"]["image"] is True
