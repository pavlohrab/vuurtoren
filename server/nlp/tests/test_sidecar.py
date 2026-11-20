"""Desktop sidecar: the token guard and the entry point's settings."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from vuurtoren_nlp import sidecar
from vuurtoren_nlp.app import app


def test_no_token_configured_means_open(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VUURTOREN_NLP_TOKEN", raising=False)
    assert TestClient(app).get("/health").status_code == 200


def test_token_is_required_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VUURTOREN_NLP_TOKEN", "s3cret")
    client = TestClient(app)
    assert client.get("/health").status_code == 401
    assert client.get("/health", headers={"X-Vuurtoren-Token": "nope"}).status_code == 401
    ok = client.get("/health", headers={"X-Vuurtoren-Token": "s3cret"})
    assert ok.status_code == 200
    assert ok.json()["status"] == "ok"


def test_main_serves_on_loopback_and_the_given_port(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def fake_run(app_: object, **kw: object) -> None:
        seen.update(kw)

    import uvicorn

    monkeypatch.setattr(uvicorn, "run", fake_run)
    monkeypatch.setenv("VUURTOREN_PORT", "45678")
    monkeypatch.setenv("VUURTOREN_EXIT_WITH_STDIN", "0")
    sidecar.main()
    assert seen["host"] == "127.0.0.1"
    assert seen["port"] == 45678
    assert seen["workers"] == 1
