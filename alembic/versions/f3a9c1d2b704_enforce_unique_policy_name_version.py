"""Enforce unique policy (name, version) pairs.

Revision ID: f3a9c1d2b704
Revises: 67a5ddc91725
Create Date: 2026-11-08 12:00:00.000000

A policy identity is its name plus version. Registering the same pair twice
silently split the audit trail across two policy rows, so the database now
enforces the invariant that the application already assumes.
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# Revision identifiers used by Alembic
revision: str = 'f3a9c1d2b704'
down_revision: Union[str, Sequence[str], None] = '67a5ddc91725'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add a unique constraint on policies(name, version)."""
    # Fail with an actionable message instead of an opaque database error when
    # the table already contains conflicting rows. Existing duplicates must be
    # resolved by a human; silently deleting governance records is not an option.
    duplicates = op.get_bind().execute(
        text(
            "SELECT name, version, COUNT(*) AS occurrences "
            "FROM policies GROUP BY name, version HAVING COUNT(*) > 1"
        )
    ).fetchall()
    if duplicates:
        conflicts = ", ".join(
            f"{row.name} v{row.version} ({row.occurrences}x)" for row in duplicates
        )
        raise RuntimeError(
            "Cannot add uq_policies_name_version: duplicate policy "
            f"(name, version) rows exist: {conflicts}. Resolve them, then rerun "
            "the migration."
        )

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
