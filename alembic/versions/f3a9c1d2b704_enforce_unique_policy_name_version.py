"""Enforce unique policy (name, version) pairs.

Revision ID: f3a9c1d2b704
Revises: 67a5ddc91725
Create Date: 2026-11-08 12:00:00.000000

A policy identity is its name plus version. Registering the same pair twice
silently split the audit trail across two policy rows, so the database now
enforces the invariant that the application already assumes.

Existing duplicates are preserved rather than deleted: historical audit events
store policy ids in their payloads, and those events are hash-chained, so
removing rows would leave dangling references. The earliest active registration
keeps the canonical ``(name, version)``; later copies are renamed with a
``+dup-<id>`` suffix and expired so they no longer participate in evaluation.
"""

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# Revision identifiers used by Alembic
revision: str = 'f3a9c1d2b704'
down_revision: Union[str, Sequence[str], None] = '67a5ddc91725'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rename_duplicate_versions() -> None:
    """Give every extra row in a duplicate (name, version) group its own version.

    The canonical row is the earliest currently-effective registration (falling
    back to the earliest overall). Extra rows are kept — not deleted — so audit
    events that reference their ids can still be resolved.
    """
    bind = op.get_bind()
    now = datetime.now(timezone.utc)

    duplicate_groups = bind.execute(
        text(
            "SELECT name, version FROM policies "
            "GROUP BY name, version HAVING COUNT(*) > 1 "
            "ORDER BY name, version"
        )
    ).fetchall()

    for group in duplicate_groups:
        rows = bind.execute(
            text(
                "SELECT id, version FROM policies "
                "WHERE name = :name AND version = :version "
                "ORDER BY (effective_to IS NOT NULL AND effective_to < :now) ASC, "
                "created_at ASC, id ASC"
            ),
            {"name": group.name, "version": group.version, "now": now},
        ).fetchall()

        used_versions = {
            value
            for (value,) in bind.execute(
                text("SELECT version FROM policies WHERE name = :name"),
                {"name": group.name},
            )
        }

        for duplicate in rows[1:]:
            identifier = str(duplicate.id).replace("-", "")
            suffix = f"+dup-{identifier[:12]}"
            new_version = f"{group.version[: max(1, 100 - len(suffix))]}{suffix}"
            if new_version in used_versions:
                # Extremely unlikely; use the full id to guarantee uniqueness.
                suffix = f"+dup-{identifier}"
                new_version = f"{group.version[: max(1, 100 - len(suffix))]}{suffix}"
            used_versions.add(new_version)

            bind.execute(
                text(
                    "UPDATE policies "
                    "SET version = :version, effective_to = :expired "
                    "WHERE id = :id"
                ),
                {
                    "version": new_version,
                    "expired": now,
                    "id": str(duplicate.id),
                },
            )


def upgrade() -> None:
    """Collapse duplicate policy identities, then enforce uniqueness."""
    _rename_duplicate_versions()

    op.create_unique_constraint(
        'uq_policies_name_version',
        'policies',
        ['name', 'version'],
    )


def downgrade() -> None:
    """Remove the unique constraint on policies(name, version)."""
    op.drop_constraint(
        'uq_policies_name_version',
        'policies',
        type_='unique',
    )
