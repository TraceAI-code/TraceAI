"""Tests for browser CORS configuration."""

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)


def test_allowed_origin_is_echoed_with_credentials():
    """Configured origins get an explicit (non-wildcard) CORS header."""
    origin = settings.cors_origin_list[0]

    res = client.get("/health", headers={"Origin": origin})

    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == origin
    assert res.headers["access-control-allow-origin"] != "*"
    assert res.headers["access-control-allow-credentials"] == "true"


def test_preflight_request_for_allowed_origin():
    """A browser preflight from an allowed origin is accepted."""
    origin = settings.cors_origin_list[0]

    res = client.options(
        "/api/v1/decisions",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == origin
    assert res.headers["access-control-allow-credentials"] == "true"


def test_disallowed_origin_gets_no_cors_header():
    """Origins that are not configured must not be granted access."""
    res = client.get("/health", headers={"Origin": "https://evil.example"})

    assert res.status_code == 200
    assert "access-control-allow-origin" not in res.headers
