"""API endpoints for replaying decisions, listing replays, and generating audit reports."""

from typing import Literal
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Decision, ReplayRun
from app.replay.engine import ReplayEngine
from app.replay.reporter import AuditReporter
from app.schemas.replay import ReplayRequest, ReplayResponse, ReplaySummaryItem

router = APIRouter(
    prefix="/api/v1/decisions",
    tags=["replay"],
)


@router.post(
    "/{decision_id}/replay",
    response_model=ReplayResponse,
    status_code=status.HTTP_200_OK,
)
def trigger_replay(
    decision_id: uuid.UUID,
    request: ReplayRequest = ReplayRequest(),
    db: Session = Depends(get_db),
):
    """Run a sandboxed replay of a past decision and compute differences from the original run."""
    decision = db.get(Decision, decision_id)
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    engine = ReplayEngine(db)
    try:
        replay_record, diff_summary = engine.replay_decision(decision_id, request)
        return ReplayResponse(
            id=replay_record.id,
            decision_id=replay_record.decision_id,
            status=replay_record.status,
            replay_mode=replay_record.replay_mode,
            similarity_score=replay_record.similarity_score,
            diff_summary=replay_record.diff_summary,
            replayed_events=replay_record.replayed_events,
            created_at=replay_record.created_at,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Replay execution failed: {str(e)}")


@router.get(
    "/{decision_id}/replays",
    response_model=list[ReplaySummaryItem],
)
def list_replays(
    decision_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    """List all replay executions completed for a specific decision."""
    decision = db.get(Decision, decision_id)
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    replays = (
        db.query(ReplayRun)
        .filter(ReplayRun.decision_id == decision_id)
        .order_by(ReplayRun.created_at.desc())
        .all()
    )
    return [
        ReplaySummaryItem(
            id=r.id,
            decision_id=r.decision_id,
            status=r.status,
            replay_mode=r.replay_mode,
            similarity_score=r.similarity_score,
            diff_summary=r.diff_summary,
            created_at=r.created_at,
        )
        for r in replays
    ]


@router.get(
    "/{decision_id}/replays/{replay_id}",
    response_model=ReplayResponse,
)
def get_replay_detail(
    decision_id: uuid.UUID,
    replay_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    """Get the full details and diff summary of a specific replay run."""
    replay = db.get(ReplayRun, replay_id)
    if not replay or replay.decision_id != decision_id:
        raise HTTPException(status_code=404, detail="Replay record not found")

    return ReplayResponse(
        id=replay.id,
        decision_id=replay.decision_id,
        status=replay.status,
        replay_mode=replay.replay_mode,
        similarity_score=replay.similarity_score,
        diff_summary=replay.diff_summary,
        replayed_events=replay.replayed_events,
        created_at=replay.created_at,
    )


@router.get(
    "/replays/run/{replay_id}",
    response_model=ReplayResponse,
)
def get_replay_by_id_only(
    replay_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    """Get the full details and diff summary of a replay run by its ID alone."""
    replay = db.get(ReplayRun, replay_id)
    if not replay:
        raise HTTPException(status_code=404, detail="Replay record not found")

    return ReplayResponse(
        id=replay.id,
        decision_id=replay.decision_id,
        status=replay.status,
        replay_mode=replay.replay_mode,
        similarity_score=replay.similarity_score,
        diff_summary=replay.diff_summary,
        replayed_events=replay.replayed_events,
        created_at=replay.created_at,
    )


@router.get(
    "/{decision_id}/audit-report",
)
def download_audit_report(
    decision_id: uuid.UUID,
    format: Literal["json", "markdown"] = Query("json"),
    db: Session = Depends(get_db),
):
    """Generate and return a compliance audit report in JSON or Markdown format."""
    decision = db.get(Decision, decision_id)
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    reporter = AuditReporter(db)
    if format == "markdown":
        md_text = reporter.generate_markdown_report(decision_id)
        return Response(content=md_text, media_type="text/markdown")
    else:
        return reporter.generate_json_report(decision_id)
