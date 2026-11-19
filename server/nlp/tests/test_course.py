"""Course OCR job: fake engine, no Tesseract needed."""

import io
import time

from fastapi.testclient import TestClient
from PIL import Image

import kenning_nlp.app as app_module
from kenning_nlp.app import app
from kenning_nlp.course import CourseOcr, data_to_blocks


def tiff_pages(n: int) -> bytes:
    frames = [Image.new("RGB", (40 + i, 40), "white") for i in range(n)]
    buf = io.BytesIO()
    frames[0].save(buf, format="TIFF", save_all=True, append_images=frames[1:])
    return buf.getvalue()


def fake_engine(img, code):
    return [{"text": f"page {img.width}", "x": 0, "y": 0, "w": 1, "h": 1}], [90.0, 80.0]


def wait_done(client: TestClient, jid: str) -> dict:
    for _ in range(200):
        body = client.get(f"/course/ocr/{jid}").json()
        if body["status"] != "running":
            return body
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def test_data_to_blocks_normalises_boxes() -> None:
    data = {
        "text": ["Oefening", "1", "Anne", "woont"],
        "conf": [90, 90, 80, 80],
        "block_num": [1, 1, 2, 2],
        "par_num": [1, 1, 1, 1],
        "line_num": [1, 1, 1, 1],
        "left": [10, 60, 10, 60],
        "top": [10, 10, 50, 50],
        "width": [40, 10, 40, 40],
        "height": [10, 10, 10, 10],
    }
    blocks = data_to_blocks(data, 100, 100)
    assert [b["text"] for b in blocks] == ["Oefening 1", "Anne woont"]
    assert blocks[0]["x"] == 0.1 and blocks[0]["w"] == 0.6 and blocks[1]["y"] == 0.5


def test_job_runs_pages_with_progress_and_cache(monkeypatch) -> None:
    calls = []

    def counting(img, code):
        calls.append(1)
        return fake_engine(img, code)

    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(counting, check=False))
    client = TestClient(app)
    data = tiff_pages(3)
    r = client.post("/course/ocr", files={"file": ("b.tiff", data, "image/tiff")})
    assert r.status_code == 200 and r.json()["total"] == 3
    body = wait_done(client, r.json()["id"])
    assert body["status"] == "done" and body["done"] == 3
    assert [p["n"] for p in body["pages"]] == [1, 2, 3]
    assert body["pages"][0]["text"] == "page 40" and body["pages"][0]["confidence"] == 0.85
    after = client.get(f"/course/ocr/{r.json()['id']}?after=2").json()
    assert [p["n"] for p in after["pages"]] == [3]
    # Same upload again: every page comes from the cache.
    again = client.post("/course/ocr", files={"file": ("b.tiff", data, "image/tiff")})
    assert wait_done(client, again.json()["id"])["done"] == 3
    assert len(calls) == 3


def test_engine_failure_is_reported(monkeypatch) -> None:
    def boom(img, code):
        raise RuntimeError("engine down")

    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(boom, check=False))
    client = TestClient(app)
    r = client.post("/course/ocr", files={"file": ("b.tiff", tiff_pages(1), "image/tiff")})
    body = wait_done(client, r.json()["id"])
    assert body["status"] == "error" and "engine down" in body["error"]


def test_unknown_job_404_and_bad_upload_415(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(fake_engine, check=False))
    client = TestClient(app)
    assert client.get("/course/ocr/nope").status_code == 404
    bad = client.post("/course/ocr", files={"file": ("x.txt", b"hello", "text/plain")})
    assert bad.status_code == 415


def test_cancel_drops_job(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(fake_engine, check=False))
    client = TestClient(app)
    r = client.post("/course/ocr", files={"file": ("b.tiff", tiff_pages(2), "image/tiff")})
    assert client.post(f"/course/ocr/{r.json()['id']}/cancel").status_code == 200
    assert client.get(f"/course/ocr/{r.json()['id']}").status_code == 404


def test_several_photos_are_one_book(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(fake_engine, check=False))
    client = TestClient(app)
    files = [
        ("file", ("p1.tiff", tiff_pages(2), "image/tiff")),
        ("file", ("p2.tiff", tiff_pages(1), "image/tiff")),
    ]
    r = client.post("/course/ocr", files=files)
    assert r.status_code == 200 and r.json()["total"] == 3
    body = wait_done(client, r.json()["id"])
    assert [p["n"] for p in body["pages"]] == [1, 2, 3]
    # The second file's single frame (40 px wide) follows the first file's two frames.
    assert [p["text"] for p in body["pages"]] == ["page 40", "page 41", "page 40"]


def test_too_many_pages_over_all_files(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(fake_engine, check=False))
    monkeypatch.setattr("kenning_nlp.course.MAX_COURSE_PAGES", 2)
    client = TestClient(app)
    files = [("file", (f"p{i}.tiff", tiff_pages(1), "image/tiff")) for i in range(3)]
    assert client.post("/course/ocr", files=files).status_code == 413


def test_decompression_bomb_is_413_not_500(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(fake_engine, check=False))
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)  # 40x40 = 1600 px > 2 * 100
    client = TestClient(app)
    r = client.post("/course/ocr", files={"file": ("b.tiff", tiff_pages(1), "image/tiff")})
    assert r.status_code == 413
    assert "too large" in r.json()["detail"]


def test_load_images_rejects_a_decompression_bomb(monkeypatch) -> None:
    import pytest

    from kenning_nlp.errors import ServiceError
    from kenning_nlp.ocr import load_images

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    with pytest.raises(ServiceError) as e:
        load_images(tiff_pages(1))
    assert e.value.status_code == 413


# --------------------------------------------------------------------------- any book


def text_pdf(pages: list[list[str]]) -> bytes:
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for lines in pages:
        y = 800
        for line in lines:
            c.drawString(72, y, line)
            y -= 16
        c.showPage()
    c.save()
    return buf.getvalue()


def epub(chapters: list[str]) -> bytes:
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr(
            "META-INF/container.xml",
            '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
        )
        items = "".join(
            f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>'
            for i in range(len(chapters))
        )
        spine = "".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
        z.writestr(
            "OEBPS/book.opf",
            f"<package><manifest>{items}</manifest><spine>{spine}</spine></package>",
        )
        for i, html in enumerate(chapters):
            z.writestr(f"OEBPS/c{i}.xhtml", f"<html><body>{html}</body></html>")
    return buf.getvalue()


def test_text_layer_pdf_needs_no_ocr(monkeypatch) -> None:
    calls = []

    def counting(img, code):
        calls.append(1)
        return fake_engine(img, code)

    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(counting, check=False))
    client = TestClient(app)
    data = text_pdf(
        [
            ["Chapter 1 Greetings", "Exercise 1 Fill in the gaps with the right word please."],
            ["Chapter 2 Shopping", "Exercise 1 Choose the right answer from the list below."],
        ]
    )
    r = client.post("/course/ocr?lang=en", files={"file": ("b.pdf", data, "application/pdf")})
    body = wait_done(client, r.json()["id"])
    assert body["status"] == "done" and body["cached"] == 2 and calls == []
    assert body["pages"][0]["text"].startswith("Chapter 1 Greetings")
    assert body["pages"][1]["confidence"] == 1.0


def test_pdf_page_with_a_garbled_text_layer_is_ocrd(monkeypatch) -> None:
    calls = []

    def counting(img, code):
        calls.append(1)
        return fake_engine(img, code)

    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(counting, check=False))
    client = TestClient(app)
    data = text_pdf(
        [
            ["Les 1 Wonen", "Anna en haar broer fietsen elke ochtend samen naar school."],
            ["Gh nrhu rqvhq ylqw khw qlhw ohxn gdw kh zhhu ylhw zhhn vfkrro nhuhq rqghu"],
        ]
    )
    r = client.post("/course/ocr", files={"file": ("b.pdf", data, "application/pdf")})
    body = wait_done(client, r.json()["id"])
    assert body["status"] == "done" and body["cached"] == 1 and calls == [1]
    assert body["pages"][1]["text"].startswith("page ")


def test_epub_chapters_are_pages(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(fake_engine, check=False))
    client = TestClient(app)
    data = epub(
        [
            "<h1>Lektion 1: Hallo</h1><p>Guten Tag. Wie geht es dir?</p><script>x()</script>",
            "<h1>Lektion 2: Einkaufen</h1><p>Ich kaufe Brot.</p>",
        ]
    )
    r = client.post("/course/ocr", files={"file": ("b.epub", data, "application/epub+zip")})
    assert r.json()["total"] == 2
    body = wait_done(client, r.json()["id"])
    assert body["pages"][0]["text"].splitlines()[0] == "Lektion 1: Hallo"
    assert "x()" not in body["pages"][0]["text"]
    assert body["pages"][1]["text"].endswith("Ich kaufe Brot.")


def test_disk_cache_survives_a_new_instance_and_order_is_kept(tmp_path, monkeypatch) -> None:
    calls = []

    def slow_first(img, code):
        calls.append(img.width)
        if img.width == 40:
            time.sleep(0.05)  # the first page finishes last; pages must still come in order
        return fake_engine(img, code)

    monkeypatch.setattr(
        app_module, "_course_ocr", CourseOcr(slow_first, check=False, workers=3, cache_dir=tmp_path)
    )
    client = TestClient(app)
    data = tiff_pages(4)
    r = client.post("/course/ocr", files={"file": ("b.tiff", data, "image/tiff")})
    body = wait_done(client, r.json()["id"])
    assert [p["text"] for p in body["pages"]] == ["page 40", "page 41", "page 42", "page 43"]
    assert len(list(tmp_path.glob("*.json"))) == 4
    # A restarted server (new instance, empty memory) reads the pages from disk.
    monkeypatch.setattr(
        app_module, "_course_ocr", CourseOcr(slow_first, check=False, cache_dir=tmp_path)
    )
    again = client.post("/course/ocr", files={"file": ("b.tiff", data, "image/tiff")})
    body = wait_done(client, again.json()["id"])
    assert body["cached"] == 4 and len(calls) == 4 and body["eta"] is None


def test_scanned_page_without_tesseract_reports_the_install_hint(monkeypatch) -> None:
    import kenning_nlp.course as course_module
    from kenning_nlp.errors import ServiceError

    def missing(lang):
        raise ServiceError(503, "Tesseract OCR is not available on the server.")

    monkeypatch.setattr(course_module, "ensure_engine", missing)
    monkeypatch.setattr(app_module, "_course_ocr", CourseOcr(fake_engine, check=True))
    client = TestClient(app)
    # An EPUB needs no OCR: it works without Tesseract.
    ok = client.post("/course/ocr", files={"file": ("b.epub", epub(["<p>Hallo</p>"]), "x")})
    assert wait_done(client, ok.json()["id"])["status"] == "done"
    r = client.post("/course/ocr", files={"file": ("b.tiff", tiff_pages(1), "image/tiff")})
    body = wait_done(client, r.json()["id"])
    assert body["status"] == "error" and "Tesseract" in body["error"]
