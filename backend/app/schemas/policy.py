"""Pydantic schemas for policy management and compliance checks."""

import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class PolicyCreate(BaseModel):
    """Payload to create or register a governance policy."""

    name: str = Field(min_length=1)
    version: str = Field(min_length=1)
    description: str | None = None
    rules: dict = Field(default_factory=dict, description="Rules definitions e.g. prohibited_tools, max_budget, pii_filter")
    effective_to: datetime | None = None


class PolicyResponse(BaseModel):
    """Full detail view of a governance policy."""

    id: uuid.UUID
    name: str
    version: str
    description: str | None
    content_hash: str
    storage_uri: str | None
    rules: dict
    effective_from: datetime
    effective_to: datetime | None
    created_at: datetime


class PolicyEvaluationCondition(BaseModel):
    """Single rule outcome within a policy evaluation."""

    name: str
    expected: str
    actual: str
    result: str


class PolicyEvaluationResponse(BaseModel):
    """A policy evaluation reconstructed from the decision audit chain."""

    id: str
    policy_id: uuid.UUID
    policy_version: str
    decision_id: uuid.UUID
    evaluated_at: datetime
    result: str
    summary: str
    conditions: list[PolicyEvaluationCondition] = Field(default_factory=list)
