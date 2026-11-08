"""Tests for canonical JSON formatting and SHA-256 hash chaining."""

from datetime import datetime, timedelta, timezone

from app.core.hashing import (
    canonical_json,
    canonical_timestamp,
    hash_event,
    sha256,
)


def test_canonical_timestamp_normalizes_to_utc():
    """Hashing must not depend on how a database round-trips timezones."""
    aware = datetime(2026, 9, 27, 10, 0, 0, tzinfo=timezone.utc)
    naive = aware.replace(tzinfo=None)
    offset = aware.astimezone(timezone(timedelta(hours=2)))

    assert canonical_timestamp(naive) == canonical_timestamp(aware)
    assert canonical_timestamp(offset) == canonical_timestamp(aware)
    assert canonical_timestamp(naive) == "2026-09-27T10:00:00+00:00"


def test_canonical_json_key_order():
    """Verify that canonical JSON output is identical regardless of key order."""
    d1 = {"b": 2, "a": 1, "c": {"y": 20, "x": 10}}
    d2 = {"c": {"x": 10, "y": 20}, "a": 1, "b": 2}
    assert canonical_json(d1) == canonical_json(d2)


def test_sha256_reproducibility():
    """Verify that SHA-256 generates consistent 64-character hash strings."""
    s = "hello traceai"
    assert sha256(s) == sha256(s)
    assert len(sha256(s)) == 64


def test_hash_chaining_deterministic():
    """Verify that event hash chaining is deterministic and links events sequentially."""
    h1 = hash_event(
        event_type="DECISION_CREATED",
        timestamp="2026-09-27T10:00:00+00:00",
        payload={"action": "start"},
        previous_hash=None,
    )
    assert len(h1) == 64

    h2 = hash_event(
        event_type="TOOL_CALL",
        timestamp="2026-09-27T10:00:01+00:00",
        payload={"tool": "search"},
        previous_hash=h1,
    )
    assert len(h2) == 64
    assert h1 != h2
