import io

from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from kenning_nlp.app import app

client = TestClient(app)


def make_pdf(pages: list[list[str]], title: str = "Testdocument") -> bytes:
    """Build a small text PDF; each page is a list of lines drawn top to bottom."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.setTitle(title)
    for lines in pages:
        y = 800
        for line in lines:
            c.drawString(50, y, line)
            y -= 16
        c.showPage()
    c.save()
    return buf.getvalue()


def post_pdf(data: bytes, name: str = "a.pdf"):
    return client.post("/extract/pdf", files={"file": (name, data, "application/pdf")})


def test_extract_text_pdf_cleans_and_joins_pages() -> None:
    pdf = make_pdf(
        [
            [
                "Journal of Dutch 2019",
                "Het was een mooie dag in de woor-",
                "den van de dichter.",
                "1",
            ],
            ["Journal of Dutch 2019", "De tweede pagina begint hier.", "2"],
        ]
    )
    r = post_pdf(pdf)
    assert r.status_code == 200
    body = r.json()
    assert body["pages"] == 2
    assert body["needs_ocr"] is False
    assert body["title"] == "Testdocument"
    assert "woorden van de dichter." in body["text"]
    assert "Journal of Dutch" not in body["text"]  # running header removed
    assert "De tweede pagina begint hier." in body["text"]


def test_image_only_pdf_needs_ocr() -> None:
    r = post_pdf(make_pdf([[""], [""]]))
    assert r.status_code == 200
    body = r.json()
    assert body["needs_ocr"] is True
    assert body["pages"] == 2
    assert body["text"] == ""


def test_not_a_pdf_is_415() -> None:
    r = post_pdf(b"hello world, definitely not a pdf")
    assert r.status_code == 415
    assert "detail" in r.json()


def test_corrupt_pdf_is_422() -> None:
    r = post_pdf(b"%PDF-1.4\nthis is garbage")
    assert r.status_code == 422


def test_empty_upload_400() -> None:
    assert post_pdf(b"").status_code == 400


def test_too_large_upload_413(monkeypatch) -> None:
    from kenning_nlp import app as app_module

    async def small_limit(file, limit=1024):
        from kenning_nlp.errors import read_upload

        return await read_upload(file, limit)

    monkeypatch.setattr(app_module, "read_upload", small_limit)
    assert post_pdf(b"%PDF-" + b"0" * 2048).status_code == 413


def test_thumbnail_of_first_pdf_page_is_a_4_5_webp() -> None:
    from PIL import Image

    pdf = make_pdf([["Hoofdstuk 1", "Een korte tekst."], ["Tweede pagina"]])
    r = client.post("/thumbnail", files={"file": ("a.pdf", pdf, "application/pdf")})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"
    img = Image.open(io.BytesIO(r.content))
    assert img.format == "WEBP"
    assert img.size == (600, 750)


def test_thumbnail_of_a_photo_and_of_junk() -> None:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (1200, 800), (200, 120, 40)).save(buf, "JPEG")
    r = client.post("/thumbnail", files={"file": ("p.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 200
    assert Image.open(io.BytesIO(r.content)).size == (600, 750)
    bad = client.post("/thumbnail", files={"file": ("x.bin", b"not an image", "text/plain")})
    assert bad.status_code == 415


# --------------------------------------------------------------------------- per-page decision

DUTCH = [
    "Het was een mooie dag in de stad en wij gingen samen naar de markt.",
    "Daar kochten we brood, kaas en groente voor het weekend bij de bakker.",
]
GARBLED = [
    "Gh nrhu rqvhq ylqw khw qlhw ohxn gdw kh zhhu ylhw zhhn vfkrro nhuhq rqghu",
    "Pdduwhq zrrqw lq hhq nohlqh vwdg pdduw gh zhhn hq ylhw gdw khw orrsw",
]


def test_text_layer_judgement() -> None:
    from kenning_nlp.pdf import text_layer_ok

    assert text_layer_ok(" ".join(DUTCH))
    assert not text_layer_ok(" ".join(GARBLED))  # a broken font encoding
    assert not text_layer_ok("12")  # (almost) nothing
    assert text_layer_ok("Hoofdstuk drie: Amsterdam, Utrecht en Rotterdam in 2019")  # too short


def test_pages_without_a_usable_text_layer_are_ocrd(monkeypatch) -> None:
    import kenning_nlp.pdf as pdf_module
    from kenning_nlp.pdf import iter_pdf_pages

    data = make_pdf([DUTCH, [""], GARBLED])
    pages = list(iter_pdf_pages(data, dpi=36))
    assert isinstance(pages[0][0], str) and pages[0][1] is None
    assert pages[1][0] is None and pages[1][1] is not None  # rendered for OCR
    assert pages[2][0] is None and pages[2][1] is not None
    previews = list(iter_pdf_pages(data, dpi=36, preview_side=200))
    assert previews[0][0] is not None and max(previews[0][1].size) <= 201

    monkeypatch.setattr(pdf_module, "_ocr_installed", lambda: True)
    assert post_pdf(make_pdf([DUTCH, GARBLED])).json()["needs_ocr"] is True
    assert post_pdf(make_pdf([DUTCH, DUTCH])).json()["needs_ocr"] is False
    # Without an OCR engine only a scan asks for OCR; a mixed PDF keeps its text layer.
    monkeypatch.setattr(pdf_module, "_ocr_installed", lambda: False)
    assert post_pdf(make_pdf([DUTCH, GARBLED])).json()["needs_ocr"] is False


def test_ocr_of_a_mixed_pdf_keeps_the_text_layer(monkeypatch) -> None:
    import kenning_nlp.ocr as ocr
    from kenning_nlp.ocr import PageRows

    monkeypatch.setattr(ocr, "ensure_engine", lambda lang: "rapidocr-nl")
    seen = []

    def fake_recognize(img, code, clean=True):
        seen.append(img.size)
        data = {
            "text": ["Gescande", "pagina."],
            "conf": [90, 80],
            "block_num": [1, 1],
            "par_num": [1, 1],
            "line_num": [1, 1],
            "left": [0, 50],
            "top": [0, 0],
            "width": [40, 40],
            "height": [10, 10],
        }
        return PageRows(data, img.width, img.height, img)

    monkeypatch.setattr(ocr, "recognize", fake_recognize)
    r = client.post(
        "/ocr?review=true",
        files={"file": ("m.pdf", make_pdf([DUTCH, [""]]), "application/pdf")},
    )
    body = r.json()
    assert r.status_code == 200 and len(seen) == 1  # only the empty page was recognised
    assert "mooie dag" in body["text"] and "Gescande pagina." in body["text"]
    assert body["confidence"] == 0.85 and body["pages"] == 2
    assert [p["n"] for p in body["review"]["pages"]] == [1, 2]
    assert body["review"]["pages"][0]["confidence"] == 1.0
