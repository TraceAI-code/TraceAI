"""Tests for decision lifecycle and cryptographic tamper detection."""

import uuid
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import AuditEvent, Decision
from app.main import app

client = TestClient(app)


def test_decision_lifecycle_and_tamper_detection():
    """Test creating decisions, logging events, linking evidence, and detecting tampering."""
    # 1. Register a new decision
    res = client.post(
        "/api/v1/decisions",
        json={
            "agent_id": "fraud_detector_agent",
            "agent_version": "1.0.0",
            "input_data": {"transaction_id": "tx_9988", "amount": 4500},
        },
    )
    assert res.status_code == 201
    decision_data = res.json()
    decision_id = decision_data["id"]
    assert decision_data["status"] == "created"
    assert len(decision_data["events"]) == 1

    # 2. Check initial cryptographic integrity
    res = client.get(f"/api/v1/decisions/{decision_id}/integrity")
    assert res.status_code == 200
    integrity = res.json()
    assert integrity["valid"] is True
    assert integrity["event_count"] == 1

    # 3. Append tool call and model inference events
    res = client.post(
        f"/api/v1/decisions/{decision_id}/events",
        json={
            "event_type": "TOOL_CALL",
            "payload": {"tool_name": "fetch_user_profile", "user_id": "user_456"},
        },
    )
    assert res.status_code == 201

    res = client.post(
        f"/api/v1/decisions/{decision_id}/events",
        json={
            "event_type": "MODEL_INFERENCE",
            "payload": {"model": "claude-3-5-sonnet", "decision": "FLAG_FOR_REVIEW", "confidence": 0.94},
        },
    )
    assert res.status_code == 201

    # 4. Check integrity of 3-event chain
    res = client.get(f"/api/v1/decisions/{decision_id}/integrity")
    assert res.status_code == 200
    integrity = res.json()
    assert integrity["valid"] is True
    assert integrity["event_count"] == 3

    # 5. Upload evidence snapshot and link to decision
    res = client.post(
        "/api/v1/evidence",
        json={
            "type": "api_response",
            "content": {"user_id": "user_456", "risk_score": 88, "status": "active"},
            "metadata": {"source": "fraud_api_v2"},
        },
    )
    assert res.status_code == 201
    evidence_id = res.json()["id"]

    res = client.post(f"/api/v1/decisions/{decision_id}/evidence/{evidence_id}?role=retrieved_profile")
    assert res.status_code == 201

    # Evidence detail returns the stored content and its linked decisions
    evidence_detail = client.get(f"/api/v1/evidence/{evidence_id}").json()
    assert evidence_detail["content_verified"] is True
    assert "risk_score" in evidence_detail["content"]
    assert any(
        linked["id"] == decision_id
        for linked in evidence_detail["linked_decisions"]
    )

    # 6. Submit a human review
    res = client.post(
        f"/api/v1/decisions/{decision_id}/reviews",
        json={
            "reviewer_id": "auditor_alice",
            "action": "approved",
            "comments": "Reviewed transaction and risk score, decision justified.",
        },
    )
    assert res.status_code == 201

    # 7. Check integrity after review action
    res = client.get(f"/api/v1/decisions/{decision_id}/integrity")
    assert res.status_code == 200
    assert res.json()["valid"] is True

    # 8. Tamper with the second event payload in the database to test detection
    db_gen = get_db()
    db: Session = next(db_gen)
    try:
        second_event = (
            db.query(AuditEvent)
            .filter(AuditEvent.decision_id == uuid.UUID(decision_id), AuditEvent.sequence_number == 2)
            .first()
        )
        assert second_event is not None
        # Modify the recorded payload
        second_event.payload = {"tool_name": "fetch_user_profile", "user_id": "TAMPERED_HACKED_USER"}
        db.commit()
    finally:
        db.close()

    # 9. Verify cryptographic integrity now fails and identifies the tampered event
    res = client.get(f"/api/v1/decisions/{decision_id}/integrity")
    assert res.status_code == 200
    corrupted_integrity = res.json()
    assert corrupted_integrity["valid"] is False
    assert corrupted_integrity["reason"] == "Event hash mismatch"
    assert corrupted_integrity["sequence_number"] == 2
