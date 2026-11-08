"""Service functions for policy registration and querying."""

import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.core.hashing import canonical_json, sha256
from app.db.models import AuditEvent, Policy
from app.schemas.policy import (
    PolicyCreate,
    PolicyEvaluationCondition,
    PolicyEvaluationResponse,
)


def create_policy(
    db: Session,
    data: PolicyCreate,
) -> Policy:
    """Create a new policy record and compute the SHA-256 hash of its rules."""
    rules_canonical = canonical_json(data.rules)
    content_hash = sha256(rules_canonical)

    policy = Policy(
        name=data.name,
        version=data.version,
        description=data.description,
        content_hash=content_hash,
        rules=data.rules,
        effective_from=datetime.now(timezone.utc),
        effective_to=data.effective_to,
    )
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return policy


def get_policy(
    db: Session,
    policy_id: uuid.UUID,
) -> Policy | None:
    """Find a policy by its unique ID."""
    return db.get(Policy, policy_id)


def list_policies(
    db: Session,
    active_only: bool = True,
) -> list[Policy]:
    """List policies, optionally filtering to only currently active ones."""
    query = db.query(Policy)
    if active_only:
        now = datetime.now(timezone.utc)
        query = query.filter(
            Policy.effective_from <= now,
            (Policy.effective_to.is_(None)) | (Policy.effective_to >= now),
        )
    return query.order_by(Policy.created_at.desc()).all()


def _evaluations_from_event(
    event: AuditEvent,
    policy_id: uuid.UUID | None = None,
) -> list[PolicyEvaluationResponse]:
    """Reconstruct per-policy evaluation results from a POLICY_EVALUATION event."""
    payload = event.payload or {}
    details = payload.get("policy_details")
    if not isinstance(details, list):
        return []

    violations = payload.get("violations") or []
    evaluations: list[PolicyEvaluationResponse] = []

    for detail in details:
        try:
            detail_policy_id = uuid.UUID(str(detail.get("id")))
        except (TypeError, ValueError, AttributeError):
            continue

        if policy_id is not None and detail_policy_id != policy_id:
            continue

        policy_violations = [
            v for v in violations
            if str(v.get("policy_id")) == str(detail_policy_id)
        ]
        conditions = [
            PolicyEvaluationCondition(
                name=str(v.get("rule_id") or v.get("type") or "rule"),
                expected=str(v.get("expected") or v.get("pattern") or "no violation"),
                actual=str(
                    v.get("actual_value")
                    if v.get("actual_value") is not None
                    else v.get("field") or v.get("tool_name") or ""
                ),
                result="FAILED",
            )
            for v in policy_violations
        ]

        if policy_violations:
            result = "FAILED"
            summary = "; ".join(
                str(v.get("message", "Policy violation")) for v in policy_violations
            )
        else:
            result = "PASSED"
            summary = (
                f"Policy '{detail.get('name', 'policy')}' passed evaluation "
                f"for decision {event.decision_id}."
            )

        evaluations.append(
            PolicyEvaluationResponse(
                id=f"{event.id}:{detail_policy_id}",
                policy_id=detail_policy_id,
                policy_version=str(detail.get("version") or "unknown"),
                decision_id=event.decision_id,
                evaluated_at=event.timestamp,
                result=result,
                summary=summary,
                conditions=conditions,
            )
        )

    return evaluations


def list_policy_evaluations(
    db: Session,
    policy_id: uuid.UUID,
    limit: int = 100,
) -> list[PolicyEvaluationResponse]:
    """List recorded evaluations for a specific policy across all decisions."""
    events = (
        db.query(AuditEvent)
        .filter(AuditEvent.event_type == "POLICY_EVALUATION")
        .order_by(AuditEvent.timestamp.desc())
        .all()
    )

    evaluations: list[PolicyEvaluationResponse] = []
    for event in events:
        evaluations.extend(_evaluations_from_event(event, policy_id=policy_id))
        if len(evaluations) >= limit:
            break
    return evaluations[:limit]


def list_decision_evaluations(
    db: Session,
    decision_id: uuid.UUID,
    limit: int = 100,
) -> list[PolicyEvaluationResponse]:
    """List recorded evaluations for a specific decision."""
    events = (
        db.query(AuditEvent)
        .filter(
            AuditEvent.decision_id == decision_id,
            AuditEvent.event_type == "POLICY_EVALUATION",
        )
        .order_by(AuditEvent.timestamp.desc())
        .all()
    )

    evaluations: list[PolicyEvaluationResponse] = []
    for event in events:
        evaluations.extend(_evaluations_from_event(event))
        if len(evaluations) >= limit:
            break
    return evaluations[:limit]
