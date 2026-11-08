"""Pydantic schemas for human auditor reviews."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# Canonical review actions. Keep this in sync with the frontend
# ``ReviewActionKind`` union and the decision status mapping in
# ``app.services.review_service``.
ReviewActionType = Literal[
    "approved",
    "rejected",
    "overridden",
    "requested_review",
    "commented",
]


class ReviewCreate(BaseModel):
    """Payload to submit a human review on a decision."""

    reviewer_id: str = Field(min_length=1)
    action: ReviewActionType
    comments: str | None = None


class ReviewResponse(BaseModel):
    """Detail view of a recorded review action."""

    id: uuid.UUID
    decision_id: uuid.UUID
    reviewer_id: str
    action: str
    comments: str | None
    created_at: datetime
