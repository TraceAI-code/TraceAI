"""API endpoints for storing, retrieving, and downloading evidence artifacts."""

import hashlib
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Decision, DecisionEvidence, Evidence
from app.schemas.evidence import (
    EvidenceCreate,
    EvidenceDetailResponse,
    EvidenceLinkedDecision,
    EvidenceResponse,
)
from app.services.evidence_service import (
    get_evidence,
    get_evidence_by_hash,
    retrieve_evidence_content,
    store_evidence,
)

router = APIRouter(
    prefix="/api/v1/evidence",
    tags=["evidence"],
)


@router.post(
    "",
    response_model=EvidenceResponse,
    status_code=status.HTTP_201_CREATED,
)
def upload_evidence(
    data: EvidenceCreate,
    db: Session = Depends(get_db),
):
    """Store evidence in content-addressable storage and return its metadata."""
    return store_evidence(db, data)


@router.get(
    "",
    response_model=list[EvidenceResponse],
)
def list_evidence(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List all stored evidence artifacts, newest first."""
    return (
        db.query(Evidence)
        .order_by(Evidence.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get(
    "/{evidence_id}",
    response_model=EvidenceDetailResponse,
)
def get_evidence_metadata(
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    """Get metadata, stored content, and linked decisions for an evidence artifact."""
    ev = get_evidence(db, evidence_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Evidence not found")

    raw_content = retrieve_evidence_content(db, evidence_id)
    content: str | None = None
    verified = False
    if raw_content is not None:
        content = raw_content.decode("utf-8", errors="replace")
        verified = hashlib.sha256(raw_content).hexdigest() == ev.content_hash

    links = (
        db.query(Decision)
        .join(DecisionEvidence, DecisionEvidence.decision_id == Decision.id)
        .filter(DecisionEvidence.evidence_id == evidence_id)
        .order_by(Decision.created_at.desc())
        .all()
    )

    return EvidenceDetailResponse(
        id=ev.id,
        type=ev.type,
        content_hash=ev.content_hash,
        storage_uri=ev.storage_uri,
        metadata_json=ev.metadata_json,
        created_at=ev.created_at,
        content=content,
        content_verified=verified,
        linked_decisions=[
            EvidenceLinkedDecision(
                id=d.id,
                agent_id=d.agent_id,
                status=d.status,
                created_at=d.created_at,
            )
            for d in links
        ],
    )


@router.get(
    "/hash/{content_hash}",
    response_model=EvidenceResponse,
)
def get_evidence_by_content_hash(
    content_hash: str,
    db: Session = Depends(get_db),
):
    """Get metadata for an evidence artifact using its SHA-256 content hash."""
    ev = get_evidence_by_hash(db, content_hash)
    if not ev:
        raise HTTPException(status_code=404, detail="Evidence not found")
    return ev


@router.get(
    "/{evidence_id}/content",
)
def download_evidence_content(
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    """Download the raw file or data stored for an evidence artifact."""
    content = retrieve_evidence_content(db, evidence_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Evidence content not found in storage")
    return Response(content=content, media_type="application/octet-stream")
