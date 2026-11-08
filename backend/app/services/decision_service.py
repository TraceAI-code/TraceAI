"""Service functions for creating, querying, and verifying decisions."""

import uuid
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.hashing import canonical_timestamp, hash_event
from app.db.models import AuditEvent, Decision, DecisionEvidence, Evidence
from app.schemas.decision import DecisionCreate, DecisionSummaryResponse
from app.services.event_recorder import EventRecorder


def create_decision(
    db: Session,
    data: DecisionCreate,
) -> Decision:
    """Create a new decision record and log its first audit event."""
    decision = Decision(
        agent_id=data.agent_id,
        agent_version=data.agent_version,
        status="created",
        input_data=data.input_data,
    )

    db.add(decision)
    db.flush()

    # Record the initial decision creation event in the audit chain
    recorder = EventRecorder(db)
    recorder.record(
        decision,
        event_type="DECISION_CREATED",
        payload={
            "agent_id": data.agent_id,
            "agent_version": data.agent_version,
            "input_data": data.input_data,
        },
    )

    db.commit()
    db.refresh(decision)
    return decision


def get_decision(
    db: Session,
    decision_id: uuid.UUID,
) -> Decision | None:
    """Fetch a single decision by its unique ID."""
    return db.get(Decision, decision_id)


def list_decisions(
    db: Session,
    skip: int = 0,
    limit: int = 50,
    agent_id: str | None = None,
    status: str | None = None,
) -> list[DecisionSummaryResponse]:
    """List decisions with basic filters and total event counts."""
    query = (
        db.query(
            Decision,
            func.count(AuditEvent.id).label("event_count")
        )
        .outerjoin(AuditEvent, Decision.id == AuditEvent.decision_id)
        .group_by(Decision.id)
        .order_by(Decision.created_at.desc())
    )

    if agent_id:
        query = query.filter(Decision.agent_id == agent_id)
    if status:
        query = query.filter(Decision.status == status)

    results = query.offset(skip).limit(limit).all()
    summaries = []
    for decision, count in results:
        summaries.append(
            DecisionSummaryResponse(
                id=decision.id,
                agent_id=decision.agent_id,
                agent_version=decision.agent_version,
                status=decision.status,
                created_at=decision.created_at,
                root_hash=decision.root_hash,
                event_count=count,
            )
        )
    return summaries


def update_decision_status(
    db: Session,
    decision_id: uuid.UUID,
    status: str,
) -> Decision | None:
    """Update the status of a decision (such as running, completed, or failed)."""
    decision = db.get(Decision, decision_id)
    if not decision:
        return None

    decision.status = status
    recorder = EventRecorder(db)
    recorder.record(
        decision,
        event_type=f"STATUS_UPDATED_{status.upper()}",
        payload={"new_status": status},
    )
    db.commit()
    db.refresh(decision)
    return decision


def link_evidence(
    db: Session,
    decision_id: uuid.UUID,
    evidence_id: uuid.UUID,
    role: str = "context",
) -> DecisionEvidence | None:
    """Attach an existing evidence record to a decision with a specific role."""
    decision = db.get(Decision, decision_id)
    evidence = db.get(Evidence, evidence_id)
    if not decision or not evidence:
        return None

    link = DecisionEvidence(
        decision_id=decision_id,
        evidence_id=evidence_id,
        role=role,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


def verify_decision_integrity(
    db: Session,
    decision_id: uuid.UUID,
) -> dict:
    """Verify that a decision's audit chain has not been altered.

    Checks three rules:
    1. Each event's saved hash matches the hash of its content.
    2. Each event links to the correct previous event hash.
    3. The decision's final root hash matches the latest event hash.
    """
    decision = db.get(Decision, decision_id)

    if decision is None:
        return {
            "valid": False,
            "reason": "Decision not found",
        }

    events = (
        db.query(AuditEvent)
        .filter(AuditEvent.decision_id == decision_id)
        .order_by(AuditEvent.sequence_number.asc())
        .all()
    )

    if not events:
        return {
            "valid": False,
            "reason": "Decision has no audit events",
        }

    previous_hash = None

    for event in events:
        calculated_hash = hash_event(
            event_type=event.event_type,
            timestamp=canonical_timestamp(event.timestamp),
            payload=event.payload,
            previous_hash=event.previous_hash,
        )

        # Check rule 1: does the calculated hash match the stored hash?
        if calculated_hash != event.event_hash:
            return {
                "valid": False,
                "reason": "Event hash mismatch",
                "event_id": str(event.id),
                "sequence_number": event.sequence_number,
            }

        # Check rule 2: does the event point to the previous event's hash?
        if event.previous_hash != previous_hash:
            return {
                "valid": False,
                "reason": "Hash chain broken",
                "event_id": str(event.id),
                "sequence_number": event.sequence_number,
            }

        previous_hash = event.event_hash

    # Check rule 3: does the stored decision root hash match the last event?
    if decision.root_hash != previous_hash:
        return {
            "valid": False,
            "reason": "Decision root hash mismatch",
        }

    return {
        "valid": True,
        "event_count": len(events),
        "root_hash": decision.root_hash,
    }
