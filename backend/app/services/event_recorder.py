"""Service for appending audit events to a decision's tamper-evident hash chain."""

import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.core.hashing import canonical_timestamp, hash_event
from app.db.models import AuditEvent, Decision, DecisionEvidence, Evidence


class EventRecorder:
    """Service that computes hashes and appends events to the decision audit chain."""

    def __init__(self, db: Session):
        self.db = db

    def record(
        self,
        decision: Decision,
        *,
        event_type: str,
        payload: dict,
        evidence_ids: list[uuid.UUID] | None = None,
    ) -> AuditEvent:
        """Append a single event to a decision's audit chain.

        Finds the last event in the chain, increments the sequence number,
        computes the new event hash linked to the previous hash, and updates
        the decision's root hash.
        """
        # Get the latest event in the decision's chain
        last_event = (
            self.db.query(AuditEvent)
            .filter(AuditEvent.decision_id == decision.id)
            .order_by(AuditEvent.sequence_number.desc())
            .first()
        )

        sequence_number = 1 if last_event is None else last_event.sequence_number + 1
        previous_hash = None if last_event is None else last_event.event_hash
        timestamp = datetime.now(timezone.utc)

        # Compute cryptographic hash for this event
        event_hash = hash_event(
            event_type=event_type,
            timestamp=canonical_timestamp(timestamp),
            payload=payload,
            previous_hash=previous_hash,
        )

        event = AuditEvent(
            decision_id=decision.id,
            event_type=event_type,
            sequence_number=sequence_number,
            timestamp=timestamp,
            payload=payload,
            previous_hash=previous_hash,
            event_hash=event_hash,
        )

        self.db.add(event)
        decision.root_hash = event_hash

        # Keep the decision lifecycle status in sync with the audit chain.
        # A policy violation is an outcome we must not overwrite with "completed".
        if event_type == "DECISION_COMPLETED":
            if decision.status not in ("policy_violated", "failed"):
                decision.status = "completed"
        elif event_type == "DECISION_FAILED":
            decision.status = "failed"
        elif event_type != "DECISION_CREATED" and decision.status == "created":
            decision.status = "running"

        # Link any evidence records referenced by this event
        if evidence_ids:
            for ev_id in evidence_ids:
                # Check that the evidence record exists before linking
                ev = self.db.get(Evidence, ev_id)
                if ev:
                    link = DecisionEvidence(
                        decision_id=decision.id,
                        evidence_id=ev.id,
                        role=event_type.lower(),
                    )
                    self.db.add(link)

        return event

    def record_batch(
        self,
        decision: Decision,
        events: list[dict],
    ) -> list[AuditEvent]:
        """Append multiple events sequentially in the exact order provided.

        Each dictionary must include 'event_type', and optional 'payload' and 'evidence_ids'.
        """
        created = []
        for ev in events:
            item = self.record(
                decision,
                event_type=ev["event_type"],
                payload=ev.get("payload", {}),
                evidence_ids=ev.get("evidence_ids"),
            )
            created.append(item)
            # Flush changes to assign sequential sequence numbers properly
            self.db.flush()
        return created
