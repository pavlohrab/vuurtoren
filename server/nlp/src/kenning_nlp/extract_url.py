"""Fetch a web page safely (SSRF-protected) and extract its main text with trafilatura.

Safety model: only http/https; the hostname is resolved by us, every resolved address must be
publicly routable (no private/loopback/link-local/multicast/reserved, IPv4 or IPv6), and the
request is then sent to that *validated IP* (Host header + TLS SNI keep the original name) so a
DNS answer cannot change between check and connect. Redirects are followed manually, each hop
going through the same checks (max 5 hops, 10 s per read, 20 s in total, 5 MB body). The total
deadline stops a server that drips bytes just fast enough to beat the per-read timeout.
"""

from __future__ import annotations

import ipaddress
import socket
import time
from collections.abc import Callable
from urllib.parse import urljoin, urlsplit

import httpx

from kenning_nlp.cleanup import normalize_text
from kenning_nlp.errors import ServiceError

MAX_REDIRECTS = 5
TIMEOUT_SECONDS = 10.0
TOTAL_DEADLINE_SECONDS = 20.0
MAX_BYTES = 5 * 1024 * 1024
MIN_TEXT_CHARS = 40
_REDIRECT_CODES = {301, 302, 303, 307, 308}
_TEXT_TYPES = ("text/html", "application/xhtml+xml", "text/plain", "application/xml", "text/xml")

IP = ipaddress.IPv4Address | ipaddress.IPv6Address


def is_public_ip(ip: IP) -> bool:
    """True only for globally routable unicast addresses (IPv4-mapped IPv6 is unwrapped)."""
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if isinstance(ip, ipaddress.IPv6Address) and ip.sixtofour is not None:
        return is_public_ip(ip.sixtofour)
    return ip.is_global and not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def resolve_host(host: str, port: int) -> list[IP]:
    """Resolve ``host`` to IP addresses (a seam that tests replace; never used for IP literals)."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise ServiceError(422, f"Could not resolve host '{host}'.") from e
    return list(dict.fromkeys(ipaddress.ip_address(i[4][0].split("%")[0]) for i in infos))


def validate_url(url: str) -> tuple[str, int, IP]:
    """Check scheme/host/credentials and return ``(host, port, validated_ip)`` for the URL.

    Raises:
        ServiceError: 400 for non-http(s) URLs or any host resolving to a non-public address;
            422 if the host does not resolve.
    """
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError as e:
        raise ServiceError(400, "Invalid URL.") from e
    if parts.scheme not in {"http", "https"}:
        raise ServiceError(400, "Only http and https URLs are supported.")
    host = parts.hostname
    if not host:
        raise ServiceError(400, "URL has no host.")
    if parts.username or parts.password:
        raise ServiceError(400, "URLs with credentials are not allowed.")
    port = port or (443 if parts.scheme == "https" else 80)
    try:
        addrs = [ipaddress.ip_address(host)]  # IP literal
    except ValueError:
        addrs = resolve_host(host, port)
    if not addrs:
        raise ServiceError(422, f"Could not resolve host '{host}'.")
    if not all(is_public_ip(a) for a in addrs):
        raise ServiceError(400, "URL points to a private or reserved address and is blocked.")
    return host, port, addrs[0]


def _make_transport() -> httpx.BaseTransport | None:
    """Transport factory (tests substitute a mock transport). ``None`` = default network."""
    return None


transport_factory: Callable[[], httpx.BaseTransport | None] = _make_transport
monotonic: Callable[[], float] = time.monotonic
"""Clock for the total deadline (tests substitute a fake)."""

_TOO_SLOW = "The page took too long to respond (20 s limit)."


def _check_deadline(deadline: float) -> None:
    if monotonic() > deadline:
        raise ServiceError(422, _TOO_SLOW)


def _request_pinned(
    client: httpx.Client, url: str, deadline: float = float("inf")
) -> tuple[httpx.Response, bytes]:
    """GET ``url`` against its validated IP; returns the response head and (capped) body."""
    host, port, ip = validate_url(url)
    parts = urlsplit(url)
    target = httpx.URL(url).copy_with(host=str(ip))
    headers = {
        "Host": host if parts.port is None else f"{host}:{port}",
        "User-Agent": "Mozilla/5.0 (compatible; KenningReader/1.0)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
    }
    ext = {"sni_hostname": host} if parts.scheme == "https" else {}
    with client.stream("GET", target, headers=headers, extensions=ext) as resp:
        if resp.status_code in _REDIRECT_CODES:
            return resp, b""
        if resp.status_code >= 400:
            raise ServiceError(422, f"The page could not be fetched (HTTP {resp.status_code}).")
        ctype = resp.headers.get("content-type", "text/html").split(";")[0].strip().lower()
        if ctype and ctype not in _TEXT_TYPES:
            raise ServiceError(415, f"Unsupported content type '{ctype}' (expected a web page).")
        body = bytearray()
        for chunk in resp.iter_bytes():
            _check_deadline(deadline)
            body += chunk
            if len(body) > MAX_BYTES:
                raise ServiceError(413, "Page is too large (limit 5 MB).")
        return resp, bytes(body)


def fetch_html(url: str) -> tuple[bytes, str]:
    """Fetch ``url`` following redirects manually. Returns ``(body, final_url)``.

    Raises:
        ServiceError: 400 blocked/invalid, 413 too large, 415 wrong type, 422 unfetchable or
            slower than ``TOTAL_DEADLINE_SECONDS`` overall.
    """
    deadline = monotonic() + TOTAL_DEADLINE_SECONDS
    try:
        with httpx.Client(
            transport=transport_factory(),
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            current = url
            for _ in range(MAX_REDIRECTS + 1):
                _check_deadline(deadline)
                resp, body = _request_pinned(client, current, deadline)
                if resp.status_code not in _REDIRECT_CODES:
                    return body, current
                location = resp.headers.get("location")
                if not location:
                    raise ServiceError(422, "Redirect without a Location header.")
                current = urljoin(current, location)
            raise ServiceError(422, f"Too many redirects (more than {MAX_REDIRECTS}).")
    except httpx.TimeoutException as e:
        raise ServiceError(422, "The page took too long to respond (10 s timeout).") from e
    except httpx.HTTPError as e:
        raise ServiceError(422, f"The page could not be fetched ({type(e).__name__}).") from e


def extract_from_url(url: str) -> dict[str, str]:
    """Fetch ``url`` and return ``{"title", "text", "url"}`` (``url`` = final URL after redirects).

    Raises:
        ServiceError: on blocked/unfetchable pages (4xx) or when no article text is found (422).
    """
    import trafilatura

    body, final_url = fetch_html(url)
    text = trafilatura.extract(
        body,
        url=final_url,
        include_comments=False,
        include_tables=False,
        favor_precision=True,
    )
    # trafilatura already emits one paragraph per line: keep them as blank-line paragraphs
    paragraphs = [p.strip() for p in normalize_text(text or "").split("\n") if p.strip()]
    text = "\n\n".join(paragraphs)
    if len(text) < MIN_TEXT_CHARS:
        raise ServiceError(422, "No readable article text found on that page.")
    meta = trafilatura.extract_metadata(body, default_url=final_url)
    title = (meta.title if meta and meta.title else "") or ""
    return {"title": title.strip(), "text": text, "url": final_url}
