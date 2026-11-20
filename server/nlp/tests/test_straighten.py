"""Page clean-up: flat scans pass unchanged; photos are found, flattened and straightened."""

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from vuurtoren_nlp import straighten
from vuurtoren_nlp.straighten import skew_angle, straighten_page

cv2 = pytest.importorskip("cv2")

WORDS = [
    "het", "huis", "de", "fiets", "een", "boek", "naar", "school", "gaan", "wij", "lezen",
    "samen", "elke", "dag",
]  # fmt: skip


def text_page(width: int = 1700, height: int = 2200, lines: int = 34) -> Image.Image:
    """A white page with lines of black text, like a flat scan."""
    font = ImageFont.load_default(size=34)
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    for i in range(lines):
        words = [WORDS[(i * 7 + k) % len(WORDS)] for k in range(14)]
        draw.text((120, 140 + i * 56), " ".join(words), fill="black", font=font)
    return img


def test_flat_scan_passes_unchanged() -> None:
    page = text_page()
    out = straighten_page(page)
    assert out.steps == []
    assert out.image is page


def test_blank_and_tiny_images_pass_unchanged() -> None:
    for img in (Image.new("RGB", (800, 600), "white"), Image.new("L", (40, 30), 255)):
        out = straighten_page(img)
        assert out.steps == [] and out.image is img


def test_rotated_scan_is_deskewed() -> None:
    page = text_page().rotate(3, expand=True, fillcolor="white")
    angle = skew_angle(np.asarray(page.convert("L")))
    assert abs(angle + 3) < 0.4  # undo the 3 degree counter-clockwise turn
    out = straighten_page(page)
    assert "deskew" in out.steps
    assert abs(skew_angle(np.asarray(out.image.convert("L")))) < 0.5


def test_photo_of_a_page_is_cut_out_and_flattened() -> None:
    page = np.asarray(text_page())
    h, w = page.shape[:2]
    canvas = np.full((int(h * 1.4), int(w * 1.4), 3), (70, 80, 95), np.uint8)
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    dst = np.array([[260, 220], [w + 360, 330], [w + 300, h + 420], [200, h + 300]], np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    photo = cv2.warpPerspective(page, m, canvas.shape[1::-1], dst=canvas,
                                borderMode=cv2.BORDER_TRANSPARENT)  # fmt: skip
    out = straighten_page(Image.fromarray(photo))
    assert out.steps[0] == "page"
    ow, oh = out.image.size
    assert abs(ow / oh - w / h) < 0.08  # the page's shape is back
    assert abs(skew_angle(np.asarray(out.image.convert("L")))) < 0.5


def test_curled_lines_are_dewarped() -> None:
    page = np.asarray(text_page().convert("L"))
    h, w = page.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = xx / w
    curled = cv2.remap(page, xx, yy - 0.03 * h * t**2.5, cv2.INTER_CUBIC,
                       borderMode=cv2.BORDER_REPLICATE)  # fmt: skip
    bend_before = straighten.bend_field(curled)
    assert bend_before is not None
    out = straighten_page(Image.fromarray(curled))
    assert "dewarp" in out.steps
    assert straighten.bend_field(np.asarray(out.image)) is None


def test_without_opencv_pages_pass_unchanged(monkeypatch) -> None:
    monkeypatch.setattr(straighten, "available", lambda: False)
    page = text_page().rotate(3, expand=True, fillcolor="white")
    assert straighten_page(page).image is page
