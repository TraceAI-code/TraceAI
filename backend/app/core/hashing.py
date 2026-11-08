"""Cryptographic hashing utilities for TraceAI.

Provides deterministic JSON serialization and SHA-256 hashing to build
tamper-evident audit chains for decisions and events.
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any


def canonical_timestamp(value: datetime) -> str:
    """Return a stable ISO-8601 UTC timestamp for hashing.

    Databases differ in whether they preserve timezone information. SQLite, for
    example, returns naive datetimes even for ``DateTime(timezone=True)``
    columns. Normalizing to UTC here keeps event hashes identical across
    database backends.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def canonical_json(data: Any) -> str:
    """Convert data into a standard JSON string.

    Keys are sorted and spacing is consistent so the same data
    always produces the exact same string and hash.
    """
    return json.dumps(
        data,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )


def sha256(data: str) -> str:
    """Return the SHA-256 hash string of the input text."""
    return hashlib.sha256(
        data.encode("utf-8")
    ).hexdigest()


def hash_event(
    *,
    event_type: str,
    timestamp: str,
    payload: dict,
    previous_hash: str | None,
) -> str:
    """Generate a cryptographic hash for an audit event.

    Includes the previous event's hash so that all events are securely
    linked together in a chain. Any tampering will break the chain.
    """
    material = {
        "event_type": event_type,
        "timestamp": timestamp,
        "payload": payload,
        "previous_hash": previous_hash,
    }

    return sha256(canonical_json(material))
