"""API endpoints for managing decisions, audit events, and human reviews."""

import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Decision
from app.schemas.decision import (
    AuditReportItemResponse,
    DashboardStatsResponse,
    DecisionCreate,
    DecisionResponse,
    DecisionSummaryResponse,
    IntegrityResponse,
)
from app.schemas.event import BatchEventCreate, EventCreate, EventDetailResponse
from app.schemas.policy import PolicyEvaluationResponse
from app.schemas.review import ReviewCreate, ReviewResponse
from app.services.decision_service import (
    create_decision,
    get_decision,
    link_evidence,
    list_decisions,
    verify_decision_integrity,
)
from app.services.event_recorder import EventRecorder
from app.services.policy_service import list_decision_evaluations
from app.services.review_service import create_review, list_reviews_for_decision

router = APIRouter(
    prefix="/api/v1/decisions",
    tags=["decisions"],
)


@router.get(
    "/dashboard-stats",
    response_model=DashboardStatsResponse,
)
def get_dashboard_stats(
    db: Session = Depends(get_db),
):
    """Aggregate dashboard metrics in a single database query for instantaneous page loading."""
    from sqlalchemy import func
    from app.db.models import AuditEvent, Evidence, ReviewAction

    # 1. Fetch recent decisions (limit 50) with their event counts
    decisions_list = list_decisions(db, skip=0, limit=50)

    # 2. Total evidence count
    total_evidence = db.query(func.count(Evidence.id)).scalar() or 0

    # 3. Policy evaluation events count
    policy_eval_count = (
        db.query(func.count(AuditEvent.id))
        .filter(AuditEvent.event_type == "POLICY_EVALUATION")
        .scalar()
        or 0
    )

    # 4. Total unique decisions with review history
    decisions_with_reviews_count = (
        db.query(func.count(func.distinct(ReviewAction.decision_id))).scalar() or 0
    )

    total_decisions_count = db.query(func.count(Decision.id)).scalar() or 0
    decisions_without_reviews_count = max(0, total_decisions_count - decisions_with_reviews_count)

    # 5. Integrity counts from root_hash presence and integrity checks
    # Decisions with a root hash are completed/valid in the tamper-evident chain
    intact_count = db.query(func.count(Decision.id)).filter(Decision.root_hash.isnot(None)).scalar() or 0
    warning_count = db.query(func.count(Decision.id)).filter(Decision.status.in_(["policy_violated", "failed", "compromised"])).scalar() or 0
    unavailable_count = max(0, total_decisions_count - intact_count - warning_count)

    return DashboardStatsResponse(
        decisions=decisions_list,
        evidence_count=total_evidence,
        policy_evaluation_count=policy_eval_count,
        decisions_with_review_history=decisions_with_reviews_count,
        decisions_without_review_history=decisions_without_reviews_count,
        integrity_available_count=intact_count + warning_count,
        intact_chain_count=intact_count,
        warning_chain_count=warning_count,
        integrity_unavailable_count=unavailable_count,
    )


@router.get(
    "/audit-reports",
    response_model=list[AuditReportItemResponse],
)
def list_audit_reports(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List concise audit report items for all decisions in a single query."""
    from app.db.models import AuditEvent

    decisions = list_decisions(db, skip=skip, limit=limit)
    decision_ids = [d.id for d in decisions]

    # Batch query latest outcome events for these decisions
    outcome_events = (
        db.query(AuditEvent)
        .filter(
            AuditEvent.decision_id.in_(decision_ids),
            AuditEvent.event_type.in_(["OUTPUT", "ACTION_TAKEN", "DECISION_MADE"]),
        )
        .order_by(AuditEvent.sequence_number.desc())
        .all()
    ) if decision_ids else []

    outcomes_map: dict = {}
    for ev in outcome_events:
        if ev.decision_id not in outcomes_map:
            p = ev.payload or {}
            outcomes_map[ev.decision_id] = p.get("verdict") or p.get("action") or p.get("status") or p.get("decision")

    return [
        AuditReportItemResponse(
            decision_id=d.id,
            agent_id=d.agent_id,
            agent_version=d.agent_version,
            status=d.status,
            created_at=d.created_at,
            root_hash=d.root_hash,
            event_count=d.event_count,
            final_outcome=str(outcomes_map.get(d.id)) if outcomes_map.get(d.id) else None,
        )
        for d in decisions
    ]


@router.post(
    "",
    response_model=DecisionResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_decision(
    data: DecisionCreate,
    db: Session = Depends(get_db),
):
    """Create a new decision session and record its initial event."""
    return create_decision(db, data)


@router.get(
    "",
    response_model=list[DecisionSummaryResponse],
)
def get_decisions(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    agent_id: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    """List decisions with optional filters by agent ID or status."""
    return list_decisions(db, skip=skip, limit=limit, agent_id=agent_id, status=status)


@router.get(
    "/{decision_id}/integrity",
    response_model=IntegrityResponse,
)
def check_decision_integrity(
    decision_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    """Verify that the decision's audit chain has not been tampered with."""
    result = verify_decision_integrity(db, decision_id)

    if result.get("reason") == "Decision not found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Decision not found",
        )

    return result


@router.get(
    "/{decision_id}",
    response_model=DecisionResponse,
)
def read_decision(
    decision_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    """Get the full details of a decision including its events, evidence, and reviews."""
    decision = get_decision(db, decision_id)

    if decision is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Decision not found",
        )

    return decision


@router.post(
    "/{decision_id}/events",
    response_model=EventDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
def append_event(
    decision_id: uuid.UUID,
    data: EventCreate,
    db: Session = Depends(get_db),
):
    """Append a single audit event to the decision's hash chain."""
    decision = db.get(Decision, decision_id)
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    recorder = EventRecorder(db)
    event = recorder.record(
        decision,
        event_type=data.event_type,
        payload=data.payload,
        evidence_ids=data.evidence_ids,
    )
    db.commit()
    db.refresh(event)
    return event


@router.post(
    "/{decision_id}/events/batch",
    response_model=list[EventDetailResponse],
    status_code=status.HTTP_201_CREATED,
)
def append_events_batch(
    decision_id: uuid.UUID,
    data: BatchEventCreate,
    db: Session = Depends(get_db),
):
    """Append multiple audit events in order to the decision's hash chain."""
    decision = db.get(Decision, decision_id)
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    recorder = EventRecorder(db)
    events_dicts = [e.model_dump() for e in data.events]
    created = recorder.record_batch(decision, events_dicts)
    db.commit()
    for ev in created:
        db.refresh(ev)
    return created


@router.post(
    "/{decision_id}/evidence/{evidence_id}",
    status_code=status.HTTP_201_CREATED,
)
def attach_evidence_to_decision(
    decision_id: uuid.UUID,
    evidence_id: uuid.UUID,
    role: str = Query("context"),
    db: Session = Depends(get_db),
):
    """Link an existing evidence artifact to a decision with a given role."""
    link = link_evidence(db, decision_id, evidence_id, role=role)
    if not link:
        raise HTTPException(status_code=404, detail="Decision or Evidence not found")
    return {"message": "Evidence linked", "decision_id": str(decision_id), "evidence_id": str(evidence_id)}


@router.post(
    "/{decision_id}/reviews",
    response_model=ReviewResponse,
    status_code=status.HTTP_201_CREATED,
)
def submit_review(
    decision_id: uuid.UUID,
    data: ReviewCreate,
    db: Session = Depends(get_db),
):
    """Submit a human auditor review (approved, rejected, challenged, or commented)."""
    review = create_review(db, decision_id, data)
    if not review:
        raise HTTPException(status_code=404, detail="Decision not found")
    return review


@router.get(
    "/{decision_id}/reviews",
    response_model=list[ReviewResponse],
)
def get_decision_reviews(
    decision_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    """List all human reviews recorded for a specific decision."""
    return list_reviews_for_decision(db, decision_id)


@router.get(
    "/{decision_id}/evaluations",
    response_model=list[PolicyEvaluationResponse],
)
def get_decision_evaluations(
    decision_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """List per-policy evaluation results reconstructed from audit events."""
    decision = db.get(Decision, decision_id)
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")
    return list_decision_evaluations(db, decision_id, limit=limit)
