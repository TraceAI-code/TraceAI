"""Database models for TraceAI.

Defines the tables used to track AI decisions, audit event chains,
evidence files, governance policies, human reviews, and replay runs.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Decision(Base):
    """Represents an AI agent decision session."""

    __tablename__ = "decisions"

    # Unique identifier for the decision
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )

    # Identifier and version of the agent making the decision
    agent_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    agent_version: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    # Current lifecycle status (such as created, running, completed, or failed)
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="created",
    )

    # Initial input data provided to the agent
    input_data: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
    )

    # Timestamp when the decision was created
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Latest cryptographic root hash representing the state of the audit chain
    root_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    # Ordered list of audit events recorded for this decision
    events: Mapped[list["AuditEvent"]] = relationship(
        back_populates="decision",
        cascade="all, delete-orphan",
        order_by="AuditEvent.sequence_number",
    )

    # Links to evidence items associated with this decision
    evidence_links: Mapped[list["DecisionEvidence"]] = relationship(
        back_populates="decision",
        cascade="all, delete-orphan",
    )

    # Human review actions performed on this decision
    review_actions: Mapped[list["ReviewAction"]] = relationship(
        back_populates="decision",
        cascade="all, delete-orphan",
        order_by="ReviewAction.created_at",
    )

    # History of replay simulations executed for this decision
    replays: Mapped[list["ReplayRun"]] = relationship(
        back_populates="decision",
        cascade="all, delete-orphan",
        order_by="ReplayRun.created_at.desc()",
    )


class AuditEvent(Base):
    """Represents a single step in a decision's tamper-evident audit chain."""

    __tablename__ = "audit_events"

    # Unique identifier for the audit event
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )

    # Foreign key referencing the parent decision
    decision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("decisions.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Type of event (for example: DECISION_CREATED, TOOL_CALL, or POLICY_EVALUATION)
    event_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    # Order of the event within the decision timeline (starting from 1)
    sequence_number: Mapped[int] = mapped_column(
        nullable=False,
    )

    # Timestamp when the event occurred
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Structured data payload for the event
    payload: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
    )

    # Hash of the previous event in the chain (None for the first event)
    previous_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    # SHA-256 hash of this event, linking it securely to the previous hash
    event_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
    )

    # Relationship back to the parent decision
    decision: Mapped["Decision"] = relationship(
        back_populates="events",
    )


class Evidence(Base):
    """Stores metadata and content hashes for supporting files and data snapshots."""

    __tablename__ = "evidence"

    # Unique identifier for the evidence artifact
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )

    # Category of evidence: document, api_response, model_input, model_output, or snapshot
    type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    # SHA-256 hash of the raw file content used for verification and lookup
    content_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    # Storage location URI (local file path or Supabase object path)
    storage_uri: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    # Additional metadata such as file name, source, or media type
    metadata_json: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
    )

    # Timestamp when the evidence was uploaded
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Links connecting this evidence to decisions
    decision_links: Mapped[list["DecisionEvidence"]] = relationship(
        back_populates="evidence",
        cascade="all, delete-orphan",
    )


class DecisionEvidence(Base):
    """Association table linking an evidence item to a specific decision."""

    __tablename__ = "decision_evidence"

    # Unique identifier for the link record
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )

    # Reference to the decision
    decision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("decisions.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Reference to the evidence artifact
    evidence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("evidence.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Role of this evidence in the decision (such as context, retrieved, tool_output, or prompt)
    role: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="context",
    )

    # Timestamp when the link was created
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationship back to the decision
    decision: Mapped["Decision"] = relationship(
        back_populates="evidence_links",
    )

    # Relationship back to the evidence artifact
    evidence: Mapped["Evidence"] = relationship(
        back_populates="decision_links",
    )


class Policy(Base):
    """Represents a governance policy rule set with versioning."""

    __tablename__ = "policies"
    __table_args__ = (
        UniqueConstraint("name", "version", name="uq_policies_name_version"),
    )

    # Unique identifier for the policy
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )

    # Name and version of the policy
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    version: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    # Short human-readable description of the policy
    description: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
    )

    # SHA-256 hash of the canonical JSON rules definition
    content_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    # Optional URI pointing to an external policy document
    storage_uri: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    # Structured policy rule definitions (such as PII filters or spending limits)
    rules: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
    )

    # Effective date range during which this policy is valid
    effective_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    effective_to: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Timestamp when the policy record was saved
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    @property
    def status(self) -> str:
        """Compute the policy lifecycle status from its effective window."""
        now = datetime.now(timezone.utc)

        effective_from = self.effective_from
        if effective_from.tzinfo is None:
            effective_from = effective_from.replace(tzinfo=timezone.utc)
        if effective_from > now:
            return "scheduled"

        if self.effective_to is not None:
            effective_to = self.effective_to
            if effective_to.tzinfo is None:
                effective_to = effective_to.replace(tzinfo=timezone.utc)
            if effective_to < now:
                return "expired"

        return "active"

    @property
    def updated_at(self) -> datetime:
        """Policies are immutable, so the creation timestamp is the last update."""
        return self.created_at


class ReviewAction(Base):
    """Represents an audit action or sign-off submitted by a human reviewer."""

    __tablename__ = "review_actions"

    # Unique identifier for the review action
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )

    # Reference to the decision that was reviewed
    decision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("decisions.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Identifier of the reviewer (such as username or email)
    reviewer_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    # Canonical action: approved, rejected, overridden, requested_review, or commented
    action: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    # Optional notes or explanation provided by the reviewer
    comments: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Timestamp when the review action was submitted
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationship back to the reviewed decision
    decision: Mapped["Decision"] = relationship(
        back_populates="review_actions",
    )


class ReplayRun(Base):
    """Stores the execution record and comparison result of a replayed decision."""

    __tablename__ = "replay_runs"

    # Unique identifier for the replay run
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )

    # Reference to the original decision being replayed
    decision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("decisions.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Final replay status (for example: matched, diverged, or failed)
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="completed",
    )

    # Replay execution mode: deterministic or what_if
    replay_mode: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="deterministic",
    )

    # Overall similarity score between original and replayed run (0.0 to 1.0)
    similarity_score: Mapped[float] = mapped_column(
        nullable=False,
        default=1.0,
    )

    # Detailed summary of differences found during comparison
    diff_summary: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
    )

    # Full list of replayed events generated during the run
    replayed_events: Mapped[list] = mapped_column(
        JSON,
        nullable=False,
        default=list,
    )

    # Timestamp when the replay was executed
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationship back to the original decision
    decision: Mapped["Decision"] = relationship(
        back_populates="replays",
    )
