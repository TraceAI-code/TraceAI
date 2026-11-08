"""Service for recording and listing human auditor reviews."""

import uuid
from sqlalchemy.orm import Session

from app.db.models import Decision, ReviewAction
from app.schemas.review import ReviewCreate
from app.services.event_recorder import EventRecorder


# Canonical review action -> decision lifecycle status.
# Every action moves the decision into a ``reviewed_*`` state so the register can
# group human decisions consistently; ``DECISION_COMPLETED`` never overwrites it.
REVIEW_STATUS_TRANSITIONS: dict[str, str] = {
    "approved": "reviewed_approved",
    "rejected": "reviewed_rejected",
    "overridden": "reviewed_overridden",
    "requested_review": "reviewed_requested_review",
    "commented": "reviewed_commented",
}


def decision_status_for_review(action: str) -> str:
    """Return the decision lifecycle status produced by a review action."""
    return REVIEW_STATUS_TRANSITIONS.get(action, f"reviewed_{action}")


def create_review(
    db: Session,
    decision_id: uuid.UUID,
    data: ReviewCreate,
) -> ReviewAction | None:
    """Record a human reviewer's action and add an audit event to the decision chain."""
    decision = db.get(Decision, decision_id)
    if not decision:
        return None

    review = ReviewAction(
        decision_id=decision_id,
        reviewer_id=data.reviewer_id,
        action=data.action,
        comments=data.comments,
    )
    db.add(review)

    # Record the human review action in the decision's tamper-evident audit chain
    recorder = EventRecorder(db)
    recorder.record(
        decision,
        event_type=f"HUMAN_REVIEW_{data.action.upper()}",
        payload={
            "reviewer_id": data.reviewer_id,
            "action": data.action,
            "comments": data.comments,
        },
    )

    decision.status = decision_status_for_review(data.action)

    db.commit()
    db.refresh(review)
    return review


def list_reviews_for_decision(
    db: Session,
    decision_id: uuid.UUID,
) -> list[ReviewAction]:
    """List all review actions recorded for a given decision, ordered newest first."""
    return (
        db.query(ReviewAction)
        .filter(ReviewAction.decision_id == decision_id)
        .order_by(ReviewAction.created_at.desc())
        .all()
    )
