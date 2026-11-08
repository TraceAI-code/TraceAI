"""Pydantic schemas for decision sessions, evidence links, reviews, and integrity status."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class DecisionCreate(BaseModel):
    """Input payload to start a new decision session."""

    agent_id: str = Field(min_length=1)
    agent_version: str = Field(min_length=1)
    input_data: dict = Field(default_factory=dict)


class EventResponse(BaseModel):
    """Audit event details returned inside a decision response."""

    id: uuid.UUID
    event_type: str
    sequence_number: int
    timestamp: datetime
    payload: dict
    previous_hash: str | None
    event_hash: str


class EvidenceLinkResponse(BaseModel):
    """Details of an evidence item linked to a decision."""

    id: uuid.UUID
    evidence_id: uuid.UUID
    role: str
    created_at: datetime


class ReviewActionResponse(BaseModel):
    """Details of a human review action on a decision."""

    id: uuid.UUID
    reviewer_id: str
    action: str
    comments: str | None
    created_at: datetime


class DecisionSummaryResponse(BaseModel):
    """Summary view of a decision used in listing endpoints."""

    id: uuid.UUID
    agent_id: str
    agent_version: str
    status: str
    created_at: datetime
    root_hash: str | None
    event_count: int = 0


class DecisionResponse(BaseModel):
    """Complete detail view of a decision, its event chain, evidence, and reviews."""

    id: uuid.UUID
    agent_id: str
    agent_version: str
    status: str
    input_data: dict
    created_at: datetime
    root_hash: str | None
    events: list[EventResponse] = []
    evidence_links: list[EvidenceLinkResponse] = []
    review_actions: list[ReviewActionResponse] = []


class IntegrityResponse(BaseModel):
    """Cryptographic audit chain verification result for a decision."""

    valid: bool
    event_count: int | None = None
    root_hash: str | None = None
    reason: str | None = None
    event_id: uuid.UUID | None = None
    sequence_number: int | None = None


class DashboardStatsResponse(BaseModel):
    """Aggregated statistics for the dashboard view."""

    decisions: list[DecisionSummaryResponse]
    evidence_count: int
    policy_evaluation_count: int
    decisions_with_review_history: int
    decisions_without_review_history: int
    integrity_available_count: int
    intact_chain_count: int
    warning_chain_count: int
    integrity_unavailable_count: int
    verified_chain_count: int = 0
    verification_failure_count: int = 0


class AuditReportItemResponse(BaseModel):
    """Concise item for the audit reports list view."""

    decision_id: uuid.UUID
    agent_id: str
    agent_version: str
    status: str
    created_at: datetime
    root_hash: str | None
    event_count: int
    final_outcome: str | None = None

