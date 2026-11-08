"""API endpoints for registering governance policies and evaluating decisions."""

from typing import Any
import uuid
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.policy import PolicyCreate, PolicyEvaluationResponse, PolicyResponse
from app.services.policy_engine import PolicyEngine
from app.services.policy_service import (
    create_policy,
    find_policy_by_name_version,
    get_policy,
    list_policies,
    list_policy_evaluations,
)

router = APIRouter(
    prefix="/api/v1/policies",
    tags=["policies"],
)


@router.post(
    "",
    response_model=PolicyResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_policy(
    data: PolicyCreate,
    db: Session = Depends(get_db),
):
    """Register a new versioned governance policy."""
    existing = find_policy_by_name_version(db, data.name, data.version)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Policy '{data.name}' version '{data.version}' already exists "
                f"(id={existing.id}). Register a new version instead."
            ),
        )
    return create_policy(db, data)


@router.get(
    "",
    response_model=list[PolicyResponse],
)
def get_policies(
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
):
    """List policies, optionally filtering to only currently active ones."""
    return list_policies(db, active_only=active_only)


@router.get(
    "/{policy_id}",
    response_model=PolicyResponse,
)
def get_policy_detail(
    policy_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    """Get the details of a specific policy by its ID."""
    policy = get_policy(db, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return policy


@router.get(
    "/{policy_id}/evaluations",
    response_model=list[PolicyEvaluationResponse],
)
def get_policy_evaluations(
    policy_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """List recorded evaluations for a policy from decision audit chains."""
    policy = get_policy(db, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return list_policy_evaluations(db, policy_id, limit=limit)


@router.post(
    "/evaluate/{decision_id}",
    status_code=status.HTTP_200_OK,
)
def evaluate_decision_policies(
    decision_id: uuid.UUID,
    target_payload: dict[str, Any] = Body(default_factory=dict),
    policy_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
):
    """Evaluate a decision against active policies or a specific policy.

    Records the evaluation result into the decision's tamper-evident audit chain.
    """
    engine = PolicyEngine(db)
    result = engine.evaluate_decision(
        decision_id=decision_id,
        target_payload=target_payload,
        policy_id=policy_id,
    )
    if not result.get("valid", True) and "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
