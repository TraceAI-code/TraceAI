"""Pydantic schemas for replay simulation and diff reporting."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel, Field


class ReplayRequest(BaseModel):
    """Configuration options for executing a decision replay."""

    mode: Literal["deterministic", "what_if"] = "deterministic"
    override_inputs: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional input overrides for 'what-if' simulation",
    )
    simulated_action: dict[str, Any] | None = Field(
        default=None,
        description="Optional simulated action outcome when running what-if counterfactuals",
    )
    simulated_reasoning: str | None = Field(
        default=None,
        description="Optional simulated reasoning text for what-if counterfactuals",
    )
    mock_tools: bool = Field(
        default=True,
        description="When True, injects recorded tool responses from Evidence Store to guarantee zero external side-effects",
    )


class ActionDiff(BaseModel):
    """Comparison of original and replayed final actions."""

    original: Any = None
    replayed: Any = None
    match: bool = True


class ToolCallDiff(BaseModel):
    """Comparison between an original tool call and its replayed call."""

    tool_name: str
    original_args: dict[str, Any] = Field(default_factory=dict)
    replayed_args: dict[str, Any] = Field(default_factory=dict)
    args_match: bool = True
    result_match: bool = True
    result_available: bool = True


class DiffSummary(BaseModel):
    """Comprehensive comparison summary between original and replayed executions."""

    is_match: bool
    status: Literal["matched", "diverged", "failed"]
    overall_similarity: float
    action_diff: ActionDiff
    tools_match: bool
    tools_executed_count: int
    tool_details: list[ToolCallDiff] = []
    reasoning_similarity_ratio: float = 1.0
    reasoning_diff: list[str] = []
    policy_diff: dict[str, Any] = Field(default_factory=dict)
    metrics_diff: dict[str, Any] = Field(default_factory=dict)
    trace_verified: bool = True
    trace_verification_reason: str | None = None
    summary: str



class ReplayResponse(BaseModel):
    """Complete detail view of a replay run and its diff summary."""

    id: UUID
    decision_id: UUID
    status: str
    replay_mode: str
    similarity_score: float
    diff_summary: dict[str, Any]
    replayed_events: list[dict[str, Any]] = []
    created_at: datetime


class ReplaySummaryItem(BaseModel):
    """Summary view of a replay run for list responses."""

    id: UUID
    decision_id: UUID
    status: str
    replay_mode: str
    similarity_score: float
    diff_summary: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
