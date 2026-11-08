"""Pydantic schemas for evidence storage and decision linking."""

import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class EvidenceCreate(BaseModel):
    """Payload to store new evidence content."""

    type: str = Field(description="Type of evidence e.g. document, api_response, model_output, snapshot")
    content: str | dict = Field(description="Raw text or JSON payload to store in content-addressable storage")
    metadata: dict = Field(default_factory=dict, description="Arbitrary metadata e.g. source, mime_type")


class EvidenceResponse(BaseModel):
    """Metadata response for a stored evidence item."""

    id: uuid.UUID
    type: str
    content_hash: str
    storage_uri: str
    metadata_json: dict
    created_at: datetime


class EvidenceLinkedDecision(BaseModel):
    """Decision that references an evidence item."""

    id: uuid.UUID
    agent_id: str
    status: str
    created_at: datetime


class EvidenceDetailResponse(EvidenceResponse):
    """Evidence metadata plus the stored content and linked decisions."""

    content: str | None = None
    content_verified: bool = False
    linked_decisions: list[EvidenceLinkedDecision] = []


class DecisionEvidenceLink(BaseModel):
    """Link association between a decision and an evidence item."""

    decision_id: uuid.UUID
    evidence_id: uuid.UUID
    role: str = "context"
    created_at: datetime
