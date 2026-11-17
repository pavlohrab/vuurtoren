"""URL extraction + SSRF protection. All network access is mocked (DNS and HTTP)."""

import ipaddress

import httpx
import pytest
from fastapi.testclient import TestClient

from kenning_nlp import extract_url
from kenning_nlp.app import app
from kenning_nlp.extract_url import is_public_ip

client = TestClient(app)

ARTICLE = """<html><head><title>Een mooi artikel</title></head><body>
<nav>menu menu menu</nav>
<article><h1>Een mooi artikel</h1>
<p>Dit is de eerste alinea van het artikel. Ze bevat genoeg tekst om als inhoud te gelden.</p>
<p>De tweede alinea gaat verder over fietsen en huizen in Nederland, een land met veel water.</p>
</article><footer>footer links</footer></body></html>"""

PUBLIC_IP = "93.184.216.34"


class Net:
    """Mock network: DNS table + per-URL httpx handlers; records requests."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, dns: dict[str, str], handler) -> None:
        self.requests: list[httpx.Request] = []

        def resolve(host: str, port: int):
            if host not in dns:
                from kenning_nlp.errors import ServiceError

                raise ServiceError(422, f"Could not resolve host '{host}'.")
            return [ipaddress.ip_address(dns[host])]

        def wrapped(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return handler(request)

        monkeypatch.setattr(extract_url, "resolve_host", resolve)
        monkeypatch.setattr(extract_url, "transport_factory", lambda: httpx.MockTransport(wrapped))


def html_ok(_: httpx.Request) -> httpx.Response:
    return httpx.Response(200, text=ARTICLE, headers={"content-type": "text/html; charset=utf-8"})


def post(url: str):
    return client.post("/extract/url", json={"url": url})


@pytest.mark.parametrize(
    ("ip", "public"),
    [
        ("93.184.216.34", True),
        ("8.8.8.8", True),
        ("2606:4700:4700::1111", True),
        ("127.0.0.1", False),
        ("10.0.0.5", False),
        ("172.16.3.4", False),
        ("192.168.1.1", False),
        ("169.254.169.254", False),
        ("100.64.0.1", False),
        ("0.0.0.0", False),
        ("224.0.0.1", False),
        ("240.0.0.1", False),
        ("::1", False),
        ("fe80::1", False),
        ("fc00::1", False),
        ("ff02::1", False),
        ("::ffff:127.0.0.1", False),
        ("::ffff:10.0.0.1", False),
        ("2002:7f00:0001::", False),  # 6to4 wrapping 127.0.0.1
    ],
)
def test_is_public_ip(ip: str, public: bool) -> None:
    assert is_public_ip(ipaddress.ip_address(ip)) is public


def test_extracts_title_and_text(monkeypatch: pytest.MonkeyPatch) -> None:
    net = Net(monkeypatch, {"example.nl": PUBLIC_IP}, html_ok)
    r = post("https://example.nl/artikel")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["title"] == "Een mooi artikel"
    assert "eerste alinea" in body["text"]
    assert "menu menu" not in body["text"]
    assert body["url"] == "https://example.nl/artikel"
    # connected to the validated IP, original name kept in Host header
    assert net.requests[0].url.host == PUBLIC_IP
    assert net.requests[0].headers["host"] == "example.nl"


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.nl/x",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "http://",
        "http://user:pw@example.nl/",
        "http://127.0.0.1/",
        "http://localhost/",
        "http://[::1]/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.1.2.3:8000/",
        "http://[::ffff:192.168.0.1]/",
    ],
)
def test_blocked_urls_are_4xx(monkeypatch: pytest.MonkeyPatch, url: str) -> None:
    net = Net(monkeypatch, {"localhost": "127.0.0.1"}, html_ok)
    r = post(url)
    assert 400 <= r.status_code < 500
    assert "detail" in r.json()
    assert net.requests == []  # nothing was ever fetched


def test_hostname_resolving_to_private_ip_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    net = Net(monkeypatch, {"evil.example": "192.168.1.10"}, html_ok)
    r = post("https://evil.example/")
    assert r.status_code == 400
    assert "private" in r.json()["detail"]
    assert net.requests == []


def test_redirect_followed_and_rechecked(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.headers["host"] == "a.example":
            return httpx.Response(302, headers={"location": "https://b.example/final"})
        return html_ok(req)

    Net(monkeypatch, {"a.example": PUBLIC_IP, "b.example": "93.184.216.35"}, handler)
    r = post("https://a.example/start")
    assert r.status_code == 200
    assert r.json()["url"] == "https://b.example/final"


def test_redirect_to_internal_address_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://169.254.169.254/secret"})

    net = Net(monkeypatch, {"a.example": PUBLIC_IP}, handler)
    r = post("https://a.example/")
    assert r.status_code == 400
    assert len(net.requests) == 1  # the internal hop was never requested


def test_redirect_to_rebinding_host_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://internal.example/"})

    Net(monkeypatch, {"a.example": PUBLIC_IP, "internal.example": "10.0.0.7"}, handler)
    assert post("https://a.example/").status_code == 400


def test_too_many_redirects(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "/again"})

    net = Net(monkeypatch, {"loop.example": PUBLIC_IP}, handler)
    r = post("https://loop.example/")
    assert r.status_code == 422
    assert "redirect" in r.json()["detail"].lower()
    assert len(net.requests) == extract_url.MAX_REDIRECTS + 1


def test_http_error_status_is_422(monkeypatch: pytest.MonkeyPatch) -> None:
    Net(monkeypatch, {"x.example": PUBLIC_IP}, lambda _: httpx.Response(404, text="nope"))
    r = post("https://x.example/missing")
    assert r.status_code == 422
    assert "404" in r.json()["detail"]


def test_timeout_is_422(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=req)

    Net(monkeypatch, {"x.example": PUBLIC_IP}, handler)
    r = post("https://x.example/")
    assert r.status_code == 422
    assert "timeout" in r.json()["detail"]


def test_unresolvable_host_is_422(monkeypatch: pytest.MonkeyPatch) -> None:
    Net(monkeypatch, {}, html_ok)
    assert post("https://nxdomain.example/").status_code == 422


def test_non_html_content_type_415(monkeypatch: pytest.MonkeyPatch) -> None:
    Net(
        monkeypatch,
        {"x.example": PUBLIC_IP},
        lambda _: httpx.Response(200, content=b"\x00\x01", headers={"content-type": "image/png"}),
    )
    assert post("https://x.example/a.png").status_code == 415


def test_oversized_body_413(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(extract_url, "MAX_BYTES", 1000)
    Net(
        monkeypatch,
        {"x.example": PUBLIC_IP},
        lambda _: httpx.Response(
            200, content=b"<p>x</p>" * 500, headers={"content-type": "text/html"}
        ),
    )
    assert post("https://x.example/").status_code == 413


def test_page_without_article_text_422(monkeypatch: pytest.MonkeyPatch) -> None:
    Net(
        monkeypatch,
        {"x.example": PUBLIC_IP},
        lambda _: httpx.Response(
            200, text="<html><body><p>hi</p></body></html>", headers={"content-type": "text/html"}
        ),
    )
    r = post("https://x.example/")
    assert r.status_code == 422
    assert "No readable" in r.json()["detail"]


def test_slow_drip_hits_the_total_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each chunk arrives in time for the per-read timeout, but the whole body takes too long."""
    now = [0.0]

    def clock() -> float:
        now[0] += 3.0  # every check sees 3 s more
        return now[0]

    monkeypatch.setattr(extract_url, "monotonic", clock)
    Net(
        monkeypatch,
        {"x.example": PUBLIC_IP},
        lambda _: httpx.Response(
            200,
            content=iter([b"<p>drip</p>"] * 50),
            headers={"content-type": "text/html"},
        ),
    )
    r = post("https://x.example/")
    assert r.status_code == 422
    assert "too long" in r.json()["detail"]
