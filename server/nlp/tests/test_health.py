from fastapi.testclient import TestClient

from vuurtoren_nlp.app import app


def test_health() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_reports_data_presence() -> None:
    body = TestClient(app).get("/health").json()
    assert body["version"]
    assert set(body["data"]) == {"dictionary", "sentences", "translation", "grammarExamples"}
    assert all(isinstance(v, bool) for v in body["data"].values())
