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
